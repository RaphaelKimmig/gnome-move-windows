// Move apps to custom workspaces on the pirmary screen

import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Meta from 'gi://Meta';



var KeyManager = class KeyManager {
  constructor() {
    this.grabbers = new Map();

    global.display.connect('accelerator-activated', (display, action, deviceId, timestamp) => {
      this._onAccelerator(action);
    });
  }

  listenFor(accelerator, callback) {
    let action = global.display.grab_accelerator(accelerator, Meta.KeyBindingFlags.NONE);

    if (action == Meta.KeyBindingAction.NONE) {
      console.log(`Unable to grab accelerator [binding=${accelerator}]`);
    } else {
      let name = Meta.external_binding_name_for_action(action);

      Main.wm.allowKeybinding(name, Shell.ActionMode.ALL);

      this.grabbers.set(action, {
        name: name,
        accelerator: accelerator,
        callback: callback,
        action: action
      });
    }
  }

  _onAccelerator(action) {
    let grabber = this.grabbers.get(action);

    if (grabber) {
      grabber.callback();
    }
  }
}


class WindowMover {
  constructor(settings) {
    this._settings = settings;
    this._appSystem = Shell.AppSystem.get_default();
    this._appConfigs = new Map();
    this._windowTracker = Shell.WindowTracker.get_default();
    this._timeout_id = null;

    this._settings.connectObject('changed',
      this._updateAppConfigs.bind(this), this);
    this._updateAppConfigs();

    this._keyManager = new KeyManager();
    this._keyManager.listenFor("<Super><Shift>o", () => {
      this.organiseWindows()
    });

  }

  _updateAppConfigs() {
    this._appConfigs.clear();

    this._settings.get_strv('application-list').forEach(v => {
      let [appId, num] = v.split(':');
      this._appConfigs.set(appId, parseInt(num) - 1);
    });
  }

  destroy() {
    this._appSystem.disconnectObject(this);
    this._settings.disconnectObject(this);
    this._windowTracker.disconnectObject(this);
    this._settings = null;
    this._windowTracker = null;

    // To stop listening:
    for (let [action, grabber] of this._keyManager.grabbers) {
      global.display.ungrab_accelerator(grabber.action);
      Main.wm.allowKeybinding(grabber.name, Shell.ActionMode.NONE);
    }

    GLib.source_remove(this._timeout_id);

    this._appConfigs.clear();
  }

  _moveWindow(window, workspaceNum) {
    if (window.skip_taskbar || window.is_on_all_workspaces())
      return;

    // ensure we have the required number of workspaces
    let workspaceManager = global.workspace_manager;
    for (let i = workspaceManager.n_workspaces; i <= workspaceNum; i++) {
      window.change_workspace_by_index(i - 1, false);
      workspaceManager.append_new_workspace(false, 0);
    }

    window.change_workspace_by_index(workspaceNum, false);
  }

  _moveWindowsToPrimaryMonitor() {
    let primaryMonitor = Main.layoutManager.primaryMonitor;
    let windows = global.get_window_actors();
    windows.forEach(windowActor => {
      let window = windowActor.meta_window;
      window.move_to_monitor(primaryMonitor.index)
    })
  }

  _moveWindowsToWorkspaces() {
    let windows = global.get_window_actors();
    windows.forEach(windowActor => {
      let window = windowActor.meta_window;
      let app = this._windowTracker.get_window_app(window);
      let workspaceNum = this._appConfigs.get(app.id);
      if (workspaceNum !== undefined) {
        this._moveWindow(window, workspaceNum)
      }
    })
  }

  organiseWindows() {
    this._moveWindowsToPrimaryMonitor()
    this._moveWindowsToWorkspaces()
  }
}

export default class OrganiseWindowsExtension extends Extension {
  enable() {
    this._prevCheckWorkspaces = Main.wm._workspaceTracker._checkWorkspaces;
    Main.wm._workspaceTracker._checkWorkspaces = this._getCheckWorkspaceOverride(this._prevCheckWorkspaces);
    this._windowMover = new WindowMover(this.getSettings());

    this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

    // Add an icon
    const icon = new St.Icon({
      icon_name: 'face-laugh-symbolic',
      style_class: 'system-status-icon',
    });
    this._indicator.add_child(icon);

    this._indicator.connect('button-press-event', () => this._windowMover.organiseWindows());

    // Add the indicator to the panel
    Main.panel.addToStatusArea(this.uuid, this._indicator);

  }

  disable() {
    Main.wm._workspaceTracker._checkWorkspaces = this._prevCheckWorkspaces;

    this._indicator?.destroy();
    this._indicator = null;

    this._windowMover.destroy();
    delete this._windowMover;

  }

  _getCheckWorkspaceOverride(originalMethod) {
    /* eslint-disable no-invalid-this */
    return function () {
      const keepAliveWorkspaces = [];
      let foundNonEmpty = false;
      for (let i = this._workspaces.length - 1; i >= 0; i--) {
        if (!foundNonEmpty) {
          foundNonEmpty = this._workspaces[i].list_windows().some(
            w => !w.is_on_all_workspaces());
        } else if (!this._workspaces[i]._keepAliveId) {
          keepAliveWorkspaces.push(this._workspaces[i]);
        }
      }

      // make sure the original method only removes empty workspaces at the end
      keepAliveWorkspaces.forEach(ws => (ws._keepAliveId = 1));
      originalMethod.call(this);
      keepAliveWorkspaces.forEach(ws => delete ws._keepAliveId);

      return false;
    };
    /* eslint-enable no-invalid-this */
  }
}

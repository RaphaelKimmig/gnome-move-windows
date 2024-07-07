// SPDX-FileCopyrightText: 2011 Giovanni Campagna <gcampagna@src.gnome.org>
// SPDX-FileCopyrightText: 2011 Alessandro Crismani <alessandro.crismani@gmail.com>
// SPDX-FileCopyrightText: 2014 Florian Müllner <fmuellner@gnome.org>
//
// SPDX-License-Identifier: GPL-2.0-or-later

// -*- mode: js2; indent-tabs-mode: nil; js2-basic-offset: 4 -*-
// Start apps on custom workspaces

import Shell from 'gi://Shell';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

class WindowMover {
  constructor(settings) {
    this._settings = settings;
    this._appSystem = Shell.AppSystem.get_default();
    this._appConfigs = new Map();
    this._windowTracker = Shell.WindowTracker.get_default();

    this._settings.connectObject('changed',
      this._updateAppConfigs.bind(this), this);
    this._updateAppConfigs();
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

  organiseWindows() {

    let primaryMonitor = Main.layoutManager.primaryMonitor;
    let windows = global.get_window_actors();
    // check for windows: https://github.com/GNOME/gnome-shell/blob/751fedb95cbb56ff23bb75ddb6e9a2210a8265c2/js/ui/workspaceAnimation.js#L57
    //
    windows.forEach(windowActor => {
      let window = windowActor.meta_window;
      window.move_to_monitor(primaryMonitor.index)

      let app = this._windowTracker.get_window_app(window);
      let workspaceNum = this._appConfigs.get(app.id);

      if (workspaceNum) {
        this._moveWindow(window, workspaceNum)
      }
    })
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

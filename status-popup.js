import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

function getDialogSize() {
    const monitor = Main.layoutManager.primaryMonitor ?? {width: 1024, height: 768};
    return {
        width: Math.min(760, Math.max(460, monitor.width - 160)),
        height: Math.min(520, Math.max(300, monitor.height - 300)),
    };
}

function format(text, ...values) {
    let index = 0;
    return text.replace(/%s/g, () => values[index++]);
}

export const StatusPopup = GObject.registerClass(
class StatusPopup extends ModalDialog.ModalDialog {
    _init({initialOutput, refresh, onClosed}) {
        super._init({styleClass: 'cato-dialog'});

        this._refreshCallback = refresh;
        this._onClosed = onClosed;
        this._output = initialOutput || _('Status not detected yet.');
        const dialogSize = getDialogSize();

        const mainBox = new St.BoxLayout({
            vertical: true,
            style_class: 'cato-dialog-box',
            width: dialogSize.width,
            x_expand: true,
        });
        this.contentLayout.add_child(mainBox);

        mainBox.add_child(new St.Label({
            text: _('Cato status details'),
            style_class: 'cato-dialog-title',
        }));

        const contentBox = new St.BoxLayout({
            vertical: true,
            style_class: 'cato-dialog-scroll-content',
        });

        const scrollView = new St.ScrollView({
            style_class: 'cato-dialog-scroll cato-status-scroll',
            width: dialogSize.width,
            height: dialogSize.height,
            x_expand: true,
            overlay_scrollbars: true,
            child: contentBox,
        });
        scrollView.set_policy(St.PolicyType.AUTOMATIC, St.PolicyType.AUTOMATIC);

        this._outputLabel = new St.Label({
            text: this._output,
            style_class: 'cato-status-output',
            x_expand: true,
        });
        this._outputLabel.clutter_text.line_wrap = false;
        this._outputLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._outputLabel.clutter_text.selectable = true;
        contentBox.add_child(this._outputLabel);
        mainBox.add_child(scrollView);

        this.addButton({
            label: _('Refresh'),
            action: () => this.refresh(),
        });
        this.addButton({
            label: _('Copy'),
            action: () => St.Clipboard.get_default().set_text(
                St.ClipboardType.CLIPBOARD,
                this._output
            ),
        });
        this.addButton({
            label: _('Close'),
            action: () => this.close(),
            key: Clutter.KEY_Escape,
        });
    }

    async refresh() {
        this._outputLabel.text = _('Reading Cato status...');
        try {
            const output = await this._refreshCallback();
            this.setOutput(output || _('The command did not return any data.'));
        } catch (error) {
            this.setOutput(format(_('Unable to read Cato status: %s'), error.message));
        }
    }

    setOutput(output) {
        this._output = output;
        this._outputLabel.text = output;
    }

    close(timestamp = global.get_current_time()) {
        super.close(timestamp);
        this._onClosed?.();
        this._onClosed = null;
    }
});

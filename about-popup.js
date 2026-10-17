import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {getDialogSize} from './dialog-utils.js';

export const AboutPopup = GObject.registerClass(
class AboutPopup extends ModalDialog.ModalDialog {
    _init(extensionPath, onClosed = null) {
        super._init({styleClass: 'cato-dialog'});
        this._closed = false;
        this._disposed = false;
        this._onClosed = onClosed;
        this._helpCancellable = new Gio.Cancellable();
        const dialogSize = getDialogSize(720, 500);

        const mainBox = new St.BoxLayout({
            vertical: true,
            style_class: 'cato-dialog-box',
            width: dialogSize.width,
            x_expand: true,
        });
        this.contentLayout.add_child(mainBox);

        mainBox.add_child(new St.Label({
            text: _('Cato VPN Manager'),
            style_class: 'cato-dialog-title',
        }));

        const contentBox = new St.BoxLayout({
            vertical: true,
            style_class: 'cato-dialog-scroll-content',
            width: dialogSize.width - 32,
            x_expand: true,
        });

        const scrollView = new St.ScrollView({
            style_class: 'cato-dialog-scroll',
            width: dialogSize.width,
            height: dialogSize.height,
            x_expand: true,
            overlay_scrollbars: true,
            child: contentBox,
        });
        scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);

        this._helpLabel = new St.Label({
            style_class: 'cato-about-content',
            width: dialogSize.width - 32,
            x_expand: true,
        });
        this._helpLabel.clutter_text.line_wrap = true;
        this._helpLabel.clutter_text.use_markup = true;
        this._helpLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        contentBox.add_child(this._helpLabel);
        contentBox.add_child(new St.Widget({height: 24}));
        mainBox.add_child(scrollView);

        this._loadHelp(this._getLocalizedHelpPath(extensionPath));
        this.addButton({
            label: _('Close'),
            action: () => this.close(),
            key: Clutter.KEY_Escape,
        });
    }

    close() {
        this._closed = true;
        this._helpCancellable.cancel();
        super.close();
    }

    destroy() {
        if (this._disposed)
            return;
        this._disposed = true;
        this._closed = true;
        this._helpCancellable.cancel();
        this.popModal();
        this._onClosed?.();
        this._onClosed = null;
        super.destroy();
    }

    _getLocalizedHelpPath(extensionPath) {
        const candidates = [];

        const addCandidate = name => {
            const path = GLib.build_filenamev([extensionPath, 'help', name]);
            if (!candidates.includes(path))
                candidates.push(path);
        };

        for (const language of GLib.get_language_names()) {
            const normalized = language
                .split(/[.@]/)[0]
                .replace(/_/g, '-')
                .toLowerCase();
            if (!normalized || normalized === 'c')
                continue;

            addCandidate(`${normalized}.md`);

            const shortLanguage = normalized.split('-')[0];
            if (shortLanguage !== normalized)
                addCandidate(`${shortLanguage}.md`);
        }

        addCandidate('en.md');

        return candidates.find(path => Gio.File.new_for_path(path).query_exists(null)) ??
            GLib.build_filenamev([extensionPath, 'help', 'en.md']);
    }

    _loadHelp(path) {
        const file = Gio.File.new_for_path(path);
        file.load_contents_async(this._helpCancellable, (source, result) => {
            try {
                const [success, contents] = source.load_contents_finish(result);
                if (success && !this._closed) {
                    const text = new TextDecoder().decode(contents);
                    this._helpLabel.clutter_text.set_markup(this._parseMarkdown(text));
                }
            } catch (_error) {
                if (!this._closed)
                    this._helpLabel.text = _('Help file not found.');
            }
        });
    }

    _parseMarkdown(text) {
        const lines = text.split('\n');
        const parsedLines = [];
        let inCodeBlock = false;

        for (const line of lines) {
            if (line.startsWith('```')) {
                inCodeBlock = !inCodeBlock;
                parsedLines.push('');
                continue;
            }

            if (inCodeBlock) {
                parsedLines.push(`<tt><span foreground="#deddda">${this._escapeMarkup(line)}</span></tt>`);
                continue;
            }

            parsedLines.push(this._formatMarkdownLine(line));
        }

        return parsedLines.join('\n');
    }

    _escapeMarkup(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    _formatMarkdownLine(line) {
        const escaped = this._escapeMarkup(line);

        if (escaped.startsWith('# '))
            return `<span size="16pt" weight="bold">${escaped.slice(2)}</span>`;
        if (escaped.startsWith('## '))
            return `<span size="13pt" weight="bold">${escaped.slice(3)}</span>`;
        if (escaped.startsWith('### '))
            return `<span size="11pt" weight="bold">${escaped.slice(4)}</span>`;
        if (escaped === '---')
            return '________________________________________________';

        let formatted = escaped
            .replace(/^(\s*)[*-] (.*$)/, '$1\u2022 $2')
            .replace(/`([^`]+)`/g, '<tt><span foreground="#deddda">$1</span></tt>')
            .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
            .replace(/\*([^*]+)\*/g, '<i>$1</i>')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '<u>$1</u>');

        return formatted;
    }
});

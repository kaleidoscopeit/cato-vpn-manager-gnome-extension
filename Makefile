UUID := catovpn-manager@kaleidoscopeit.github.com
GETTEXT_DOMAIN := catovpn-manager
SCHEMA := schemas/org.gnome.shell.extensions.catovpn-manager.gschema.xml
DIST_DIR := dist
LOCALE_DIR := locale
IT_PO := po/it.po
IT_MO := $(LOCALE_DIR)/it/LC_MESSAGES/$(GETTEXT_DOMAIN).mo

.PHONY: check check-code check-translations package clean build-locales

check: check-code check-translations

check-code:
	glib-compile-schemas --strict --dry-run schemas
	bash -n optional-helper/cato-vpn-route-helper
	sh -n optional-helper/install-helper.sh
	sh -n optional-helper/uninstall-helper.sh
	gjs -m tests/test-state.js

check-translations:
	msgfmt --check --check-format -o /dev/null $(IT_PO)

build-locales: $(IT_MO)

$(IT_MO): $(IT_PO)
	mkdir -p $(dir $@)
	msgfmt -o $@ $<

package: check build-locales
	mkdir -p $(DIST_DIR)
	gnome-extensions pack --force --out-dir=$(DIST_DIR) \
		--schema=$(SCHEMA) \
		--extra-source=about-popup.js \
		--extra-source=cato-state.js \
		--extra-source=status-popup.js \
		--extra-source=command.js \
		--extra-source=shared.js \
		--extra-source=dialog-utils.js \
		--extra-source=LICENSE \
		--extra-source=help \
		--extra-source=$(LOCALE_DIR) \
		--extra-source=icons .

clean:
	rm -f $(DIST_DIR)/$(UUID).shell-extension.zip
	rm -f schemas/gschemas.compiled
	rm -rf $(LOCALE_DIR)

UUID := catovpn-manager@kaleidoscopeit.github.com
GETTEXT_DOMAIN := catovpn-manager
SCHEMA := schemas/org.gnome.shell.extensions.catovpn-manager.gschema.xml
DIST_DIR := dist
LOCALE_DIR := locale
IT_MO := $(LOCALE_DIR)/it/LC_MESSAGES/$(GETTEXT_DOMAIN).mo

.PHONY: check package clean build-locales

check: build-locales
	glib-compile-schemas --strict --dry-run schemas
	bash -n optional-helper/cato-vpn-route-helper
	sh -n optional-helper/install-helper.sh
	sh -n optional-helper/uninstall-helper.sh
	gjs -m tests/test-state.js

build-locales:
	gjs -m tools/compile-po.js po/it.po $(IT_MO)

package: check
	mkdir -p $(DIST_DIR)
	PATH=$(CURDIR)/tools:$$PATH gnome-extensions pack --force --out-dir=$(DIST_DIR) \
		--schema=$(SCHEMA) \
		--extra-source=about-popup.js \
		--extra-source=cato-state.js \
		--extra-source=status-popup.js \
		--extra-source=help \
		--extra-source=$(LOCALE_DIR) \
		--extra-source=icons .

clean:
	rm -f $(DIST_DIR)/$(UUID).shell-extension.zip
	rm -f schemas/gschemas.compiled
	rm -rf $(LOCALE_DIR)

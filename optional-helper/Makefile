HELPER_DIR := /usr/libexec
POLKIT_DIR := /usr/share/polkit-1/actions
.PHONY: install uninstall
install:
	install -D -o root -g root -m 0755 cato-vpn-route-helper $(DESTDIR)$(HELPER_DIR)/cato-vpn-route-helper
	install -D -o root -g root -m 0644 polkit/com.github.kaleidoscopeit.catovpn-manager.policy $(DESTDIR)$(POLKIT_DIR)/com.github.kaleidoscopeit.catovpn-manager.policy
uninstall:
	rm -f $(DESTDIR)$(HELPER_DIR)/cato-vpn-route-helper
	rm -f $(DESTDIR)$(POLKIT_DIR)/com.github.kaleidoscopeit.catovpn-manager.policy

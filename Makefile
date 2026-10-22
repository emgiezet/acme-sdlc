.PHONY: help test validate install

BIN_DIR ?= $(HOME)/.local/bin

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | sed 's/:.*## /\t/'

test: ## Unit tests (node:test, no dependencies)
	cd plugins/acme && node --test tests/*.test.mjs

validate: ## Manifests parse, versions agree, the example config resolves
	@for f in .claude-plugin/marketplace.json .omp-plugin/marketplace.json plugins/acme/plugin.json plugins/acme/package.json examples/.acme/project.json; do \
		jq -e . "$$f" > /dev/null || { echo "invalid JSON: $$f"; exit 1; }; echo "  ✓ $$f"; done
	@v=$$(jq -r .version plugins/acme/plugin.json); \
		for f in .claude-plugin/marketplace.json .omp-plugin/marketplace.json; do \
			test "$$(jq -r '.plugins[0].version' $$f)" = "$$v" || { echo "version mismatch: $$f"; exit 1; }; done; \
		test "$$(jq -r .version plugins/acme/package.json)" = "$$v" || { echo "version mismatch: package.json"; exit 1; }; \
		echo "  ✓ versions agree ($$v)"
	@node -e 'import("./plugins/acme/lib/config.mjs").then(({resolveConfig}) => { resolveConfig(JSON.parse(require("fs").readFileSync("examples/.acme/project.json","utf8"))); console.log("  ✓ example config resolves") })'

install: ## Link acme-queue and acme-rules into $(BIN_DIR)
	mkdir -p $(BIN_DIR)
	ln -sf $(CURDIR)/plugins/acme/bin/acme-queue $(BIN_DIR)/acme-queue
	ln -sf $(CURDIR)/plugins/acme/bin/acme-rules $(BIN_DIR)/acme-rules
	@echo "linked acme-queue and acme-rules into $(BIN_DIR)"

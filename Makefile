# Makefile — common dev / ops commands.
# Usage: `make help`

SHELL := bash
.DEFAULT_GOAL := help

.PHONY: help dev install test audit seed serve secrets compose-up compose-down clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install backend deps + produce package-lock.json
	cd backend && npm install

dev: ## Run backend in watch mode
	cd backend && npm run dev

serve: ## Serve the frontend over HTTP (port 8080)
	python -m http.server 8080

test: ## Run backend test suite
	cd backend && npm test

audit: ## Security audit (prod deps only)
	cd backend && npm run audit

seed: ## Seed first admin + AppConfig
	cd backend && npm run seed

seed-force: ## Reseed admin password from ADMIN_PASSWORD env
	cd backend && npm run seed -- --force-password

secrets: ## Generate a set of production secrets to stdout
	@echo "# Paste into backend/.env"
	@echo "JWT_SECRET=$$(node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\")"
	@echo "REFRESH_SECRET=$$(node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\")"
	@echo "IP_SALT=$$(node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")"
	@echo "MONGO_ROOT_PASSWORD=$$(node -e \"console.log(require('crypto').randomBytes(24).toString('hex'))\")"

compose-up: ## Docker compose up (requires .env loaded)
	cd backend && docker compose up -d --build

compose-down: ## Docker compose down
	cd backend && docker compose down

clean: ## Remove build artifacts + node_modules
	rm -rf backend/node_modules backend/coverage backend/.vite

.PHONY: help install dev build lint test check preview docker-build docker-run clean

help: ## Show this help message
	@awk 'BEGIN {FS = ":.*?## "; printf "Usage: make <target>\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install npm dependencies
	npm install

dev: ## Start the Vite development server
	npm run dev

build: ## Create a production build
	npm run build

lint: ## Run ESLint over the project
	npm run lint

test: ## Run the Vitest unit-test suite
	npm test

check: ## Run lint, tests, and production build
	npm run check

preview: build ## Preview the production build locally
	npm run preview

docker-build: ## Build the Docker image
	docker build -t price-matrix-optimizer .

docker-run: docker-build ## Run the Docker image on port 8080
	docker run -p 8080:80 --rm price-matrix-optimizer

clean: ## Remove build artifacts and node_modules
	rm -rf dist node_modules

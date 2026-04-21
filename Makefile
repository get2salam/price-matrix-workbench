.PHONY: dev build lint preview docker-build docker-run clean

dev:
	npm run dev

build:
	npm run build

lint:
	npm run lint

preview: build
	npm run preview

docker-build:
	docker build -t price-matrix-optimizer .

docker-run: docker-build
	docker run -p 8080:80 --rm price-matrix-optimizer

clean:
	rm -rf dist node_modules

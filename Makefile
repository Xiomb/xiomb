.PHONY: test build clean demo

test:
	cd js && npm ci && npm test

build:
	cd js && npm ci && npm run build

clean:
	rm -rf js/proto

demo:
	cd js && npm ci && npm run build
	cd js && test -f demo/ssl/demo.crt || npm run demo:cert
	cd js && npm run demo

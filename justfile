build: clean
    npm run build
    cd press-ready-gui && npm run tauri build
    @echo "GUI bundle: press-ready-gui/src-tauri/target/release/bundle/"

test: build
    npm test

test-lint: build
    node ./lib/cli.js lint ./test/fixture/review.pdf

clean:
    npm run clean

fmt:
    deno fmt

fmt-check:
    deno fmt --check

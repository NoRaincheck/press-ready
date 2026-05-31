build:
    npm run build

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

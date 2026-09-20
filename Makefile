.PHONY: dev down install clean status restart

install:
	pnpm install
	@echo "Run 'pnpm dev' to start"

dev:
	pnpm dev

down:
	pnpm app:stop

clean:
	pnpm clean:build

status:
	pnpm app:status

restart:
	pnpm app:restart

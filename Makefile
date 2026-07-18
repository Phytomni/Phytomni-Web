# Phytomni-Web quality-gate entrypoints.
#
# The scoped target intentionally runs the full repository gate until the
# proven changed-file resolver is introduced later in the quality program.

SHELL := /bin/sh

GIT_SSH_KEEPALIVE := ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=6

.DEFAULT_GOAL := help
.PHONY: help scoped full push

help:
	@printf 'Phytomni-Web quality gate targets:\n\n'
	@printf '  make scoped      temporary full gate while scope resolution is pending\n'
	@printf '  make full        full validate_web_local.sh gate\n'
	@printf '  make push        git push with SSH keepalive; hooks still run\n'
	@printf '  make help        show this message\n\n'

scoped:
	@./scripts/validate_web_local.sh

full:
	@./scripts/validate_web_local.sh

push:
	@GIT_SSH_COMMAND='$(GIT_SSH_KEEPALIVE)' git push $(ARGS)

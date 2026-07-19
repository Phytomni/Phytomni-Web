# Phytomni-Web quality-gate entrypoints.
#
# Scoped targets resolve changed files before running the smallest safe set of
# repository checks. The full target remains the authoritative CI-equivalent
# wrapper.

SHELL := /bin/sh

GIT_SSH_KEEPALIVE := ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=6

.DEFAULT_GOAL := help
.PHONY: help scoped precommit prepush full push

help:
	@printf 'Phytomni-Web quality gate targets:\n\n'
	@printf '  make precommit   scoped gate over the STAGED index\n'
	@printf '  make prepush     scoped gate over BASE..work-tree\n'
	@printf '  make scoped      alias of prepush (range scope)\n'
	@printf '  make full        full gate (validate_web_local.sh)\n'
	@printf '  make push        git push with SSH keepalive; hooks still run\n'
	@printf '  make help        show this message\n\n'

scoped:
	@./scripts/scoped_gate.sh scoped

precommit:
	@./scripts/scoped_gate.sh precommit

prepush:
	@./scripts/scoped_gate.sh prepush

full:
	@./scripts/validate_web_local.sh

push:
	@GIT_SSH_COMMAND='$(GIT_SSH_KEEPALIVE)' git push $(ARGS)

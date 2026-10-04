'use strict';

/** @test-kind unit @test-runner jest @test-requires none */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const enforcement = fs.readFileSync(path.join(ROOT, '.github/workflows/pr-enforcement.yml'), 'utf8');
const dispatcher = fs.readFileSync(path.join(ROOT, '.github/workflows/pr-enforcement-dispatch.yml'), 'utf8');

describe('PR enforcement trusted dispatch', () => {
  test('heavy enforcement supports trusted workflow dispatch', () => {
    expect(enforcement).toContain('workflow_dispatch:');
    expect(enforcement).toContain('pr_number:');
    expect(enforcement).toContain('head_sha:');
    expect(enforcement).toContain('base_sha:');
    expect(enforcement).toContain('head_ref:');
    expect(enforcement).toContain('base_ref:');
  });

  test('trusted pull_request_target only dispatches internal PRs', () => {
    expect(dispatcher).toContain('pull_request_target:');
    expect(dispatcher).toContain('github.event.pull_request.head.repo.full_name == github.repository');
    expect(dispatcher).toContain('/actions/workflows/pr-enforcement.yml/dispatches');
    expect(dispatcher).toContain('actions: write');
  });

  test('workflow dispatch certifies the exact supplied PR head and branch', () => {
    expect(enforcement).toContain('ref: ${{ inputs.head_sha || github.event.pull_request.head.sha }}');
    expect(enforcement).toContain('BASE_SHA: ${{ inputs.base_sha || github.event.pull_request.base.sha }}');
    expect(enforcement).toContain('HEAD_REF: ${{ inputs.head_ref || github.event.pull_request.head.ref }}');
    expect(enforcement).toContain('event=workflow_dispatch&branch=$BRANCH_ENCODED');
  });
});

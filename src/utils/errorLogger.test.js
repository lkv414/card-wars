/**
 * errorLogger.test.js — Unit-тесты для централизованного логирования ошибок
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  logError,
  logWarn,
  logInfo,
  withErrorLogging,
  withSyncErrorLogging,
  safeExecute
} from './errorLogger.js'

test('logError is a function', () => {
  assert.equal(typeof logError, 'function')
})

test('logWarn is a function', () => {
  assert.equal(typeof logWarn, 'function')
})

test('logInfo is a function', () => {
  assert.equal(typeof logInfo, 'function')
})

test('withErrorLogging is a function', () => {
  assert.equal(typeof withErrorLogging, 'function')
})

test('withSyncErrorLogging is a function', () => {
  assert.equal(typeof withSyncErrorLogging, 'function')
})

test('safeExecute is a function', () => {
  assert.equal(typeof safeExecute, 'function')
})

test('withErrorLogging passes through arguments', async () => {
  const asyncFn = async (a, b) => a + b
  const wrapped = withErrorLogging(asyncFn)
  
  const result = await wrapped(1, 2)
  assert.equal(result, 3)
})

test('withSyncErrorLogging passes through arguments', () => {
  const syncFn = (a, b) => a + b
  const wrapped = withSyncErrorLogging(syncFn)
  
  const result = wrapped(1, 2)
  assert.equal(result, 3)
})

test('safeExecute returns success result on successful execution', async () => {
  const fn = () => 'success'
  const result = await safeExecute(fn, { module: 'test' })
  
  assert.equal(result.success, true)
  assert.equal(result.result, 'success')
  assert.equal(result.error, undefined)
})

test('safeExecute returns error result on failure', async () => {
  const fn = () => {
    throw new Error('Test error')
  }
  const result = await safeExecute(fn, { module: 'test' })
  
  assert.equal(result.success, false)
  assert.ok(result.error)
  assert.equal(result.error.message, 'Test error')
  assert.equal(result.result, undefined)
})

test('safeExecute converts non-Error to Error object', async () => {
  const fn = () => {
    throw 'string error'
  }
  const result = await safeExecute(fn)
  
  assert.equal(result.success, false)
  assert.ok(result.error instanceof Error)
  assert.equal(result.error.message, 'string error')
})

test('safeExecute does not throw on failure', async () => {
  const fn = () => {
    throw new Error('Test error')
  }
  await assert.doesNotThrow(async () => await safeExecute(fn))
})

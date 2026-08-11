/**
 * errorLogger.js — Centralized error logging utility
 * 
 * Содержит функции для логирования ошибок в консоль и отправки в Sentry.
 * Поддерживает контекст ошибок для лучшей отладки.
 */

/**
 * @param {unknown} error
 * @returns {string}
 */
export function formatErrorMessage(error) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    if (typeof error.message === 'string') return error.message
    if (typeof error.error === 'string') return error.error
    if (typeof error.details === 'string') return error.details
  }
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

/**
 * User-friendly message for common Supabase/network failures.
 * @param {unknown} error
 * @returns {string}
 */
export function toUserFacingError(error) {
  const msg = formatErrorMessage(error)
  const lower = msg.toLowerCase()
  if (
    lower.includes('failed to fetch')
    || lower.includes('networkerror')
    || lower.includes('connection refused')
    || lower.includes('err_connection_refused')
  ) {
    const url = import.meta.env.VITE_SUPABASE_URL || ''
    if (url.includes('127.0.0.1') || url.includes('localhost')) {
      return 'Локальный Supabase недоступен. Запустите Docker и выполните: npx supabase start'
    }
    return 'Не удалось подключиться к Supabase. Проверьте интернет и VITE_SUPABASE_URL.'
  }
  return msg
}

/**
 * Логировать ошибку
 * @param {Error|string|object} error - Ошибка или сообщение об ошибке
 * @param {Object} [context={}] - Контекст ошибки (модуль, действие, дополнительные данные)
 * @param {string} [level='error'] - Уровень логирования ('error', 'warn', 'info')
 */
export function logError(error, context = {}, level = 'error') {
  const message = formatErrorMessage(error);
  const stack = error instanceof Error ? error.stack : undefined;
  
  const logEntry = {
    message,
    context,
    timestamp: new Date().toISOString(),
    ...(stack && { stack }),
  };

  switch (level) {
    case 'warn':
      console.warn('[CardWars]', {
        ...logEntry,
        level: 'WARN',
      });
      break;
    case 'info':
      console.info('[CardWars]', {
        ...logEntry,
        level: 'INFO',
      });
      break;
    case 'error':
    default:
      console.error('[CardWars] ERROR', {
        ...logEntry,
        level: 'ERROR',
      });
  }

  // Отправить в Sentry в продакшене
  if (typeof window !== 'undefined' && window.Sentry) {
    try {
      const sentryLevel = level === 'warn' ? 'warning' : level;
      window.Sentry.captureException(error, {
        extra: context,
        level: sentryLevel,
      });
    } catch (sentryError) {
      console.error('[CardWars] Failed to send error to Sentry:', sentryError);
    }
  }
}

/**
 * Логировать предупреждение
 * @param {Error|string} warning - Предупреждение или сообщение
 * @param {Object} [context={}] - Контекст
 */
export function logWarn(warning, context = {}) {
  logError(warning, context, 'warn');
}

/**
 * Логировать информационное сообщение
 * @param {string} message - Сообщение
 * @param {Object} [context={}] - Контекст
 */
export function logInfo(message, context = {}) {
  logError(message, context, 'info');
}

/**
 * Создать обертку для асинхронных функций с автоматическим логированием ошибок
 * @param {Function} asyncFn - Асинхронная функция
 * @param {Object} context - Контекст для логирования
 * @returns {Function} Обернутая функция
 */
export function withErrorLogging(asyncFn, context = {}) {
  return async function(...args) {
    try {
      return await asyncFn(...args);
    } catch (error) {
      logError(error, {
        function: asyncFn.name,
        ...context,
      });
      throw error;
    }
  };
}

/**
 * Создать обертку для синхронных функций с автоматическим логированием ошибок
 * @param {Function} fn - Функция
 * @param {Object} context - Контекст для логирования
 * @returns {Function} Обернутая функция
 */
export function withSyncErrorLogging(fn, context = {}) {
  return function(...args) {
    try {
      return fn(...args);
    } catch (error) {
      logError(error, {
        function: fn.name,
        ...context,
      });
      throw error;
    }
  };
}

/**
 * Утилита для безопасного выполнения кода с логированием
 * @param {Function} fn - Функция для выполнения
 * @param {Object} context - Контекст для логирования
 * @returns {Promise<{success: boolean, result?: any, error?: Error}>}
 */
export async function safeExecute(fn, context = {}) {
  try {
    const result = await fn();
    return { success: true, result };
  } catch (error) {
    logError(error, context);
    return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

export default {
  formatErrorMessage,
  toUserFacingError,
  logError,
  logWarn,
  logInfo,
  withErrorLogging,
  withSyncErrorLogging,
  safeExecute,
};

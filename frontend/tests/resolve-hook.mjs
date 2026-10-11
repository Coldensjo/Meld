// Lets Node run the app's TypeScript, whose relative imports omit the extension (as Vite expects).
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.\w+$/.test(specifier)) {
      return next(specifier + '.ts', context)
    }
    throw e
  }
}

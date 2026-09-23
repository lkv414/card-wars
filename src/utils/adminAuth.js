export function isAdminUser(user) {
  if (!user) return false
  // Never trust user_metadata for authorization; it is user-editable.
  return user.app_metadata?.role === 'admin'
}

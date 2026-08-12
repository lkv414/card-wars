export function isAdminUser(user) {
  if (!user) return false
  const role = user.app_metadata?.role ?? user.user_metadata?.role
  return role === 'admin'
}

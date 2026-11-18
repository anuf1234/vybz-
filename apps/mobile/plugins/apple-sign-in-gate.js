// Keeps the Sign in with Apple entitlement out of the build unless
// ios.usesAppleSignIn is true. expo-apple-authentication adds it on its own,
// and an App ID/provisioning profile without the capability fails the build.
const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function appleSignInGate(config) {
  return withEntitlementsPlist(config, (cfg) => {
    if (!cfg.ios?.usesAppleSignIn) delete cfg.modResults["com.apple.developer.applesignin"];
    return cfg;
  });
};

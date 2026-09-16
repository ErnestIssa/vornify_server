/**
 * Runtime application version and Git SHA for health/version payloads.
 * Does not include secrets, env dumps, or infrastructure details.
 */
const { execSync } = require('child_process');
const pkg = require('../package.json');

function sanitizeGitSha(value) {
    return String(value || '').replace(/[^a-fA-F0-9]/g, '').slice(0, 40);
}

function resolveGitSha() {
    const fromEnv = sanitizeGitSha(
        process.env.RENDER_GIT_COMMIT ||
            process.env.COMMIT_REF ||
            process.env.SOURCE_VERSION ||
            process.env.GIT_COMMIT ||
            ''
    );
    if (fromEnv.length >= 7) return fromEnv;
    try {
        return sanitizeGitSha(
            execSync('git rev-parse HEAD', {
                cwd: __dirname,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore']
            })
        );
    } catch {
        return '';
    }
}

function runtimeVersion() {
    const canonical = String(pkg.version || '').trim();
    const override = String(process.env.BACKEND_APP_VERSION || '').trim();
    if (override && override !== canonical) {
        console.warn(
            `[appBuild] Ignoring BACKEND_APP_VERSION=${override}; package.json version ${canonical} is the application version`
        );
    }
    return canonical;
}

function buildInfo() {
    const gitSha = resolveGitSha().slice(0, 7);
    const info = { version: runtimeVersion() };
    if (gitSha) info.gitSha = gitSha;
    return info;
}

module.exports = {
    runtimeVersion,
    resolveGitSha,
    buildInfo
};

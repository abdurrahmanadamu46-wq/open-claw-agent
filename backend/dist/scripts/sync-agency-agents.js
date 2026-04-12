"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
const gray_matter_1 = __importDefault(require("gray-matter"));
const GITHUB_OWNER = 'msitarzewski';
const GITHUB_REPO = 'agency-agents';
const GITHUB_BRANCH = 'main';
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;
const API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;
function divisionFromPath(filePath) {
    const segments = filePath.split('/').filter(Boolean);
    if (segments.length >= 2) {
        const folder = segments[0];
        return folder.charAt(0).toUpperCase() + folder.slice(1).toLowerCase();
    }
    return 'Specialized';
}
function idFromPath(filePath) {
    return filePath
        .replace(/\.md$/i, '')
        .replace(/\//g, '-')
        .toLowerCase();
}
function splitSections(content) {
    const sections = {};
    const regex = /^##\s+(.+)$/gm;
    let lastIndex = 0;
    let lastTitle = '';
    let m;
    while ((m = regex.exec(content)) !== null) {
        if (lastTitle) {
            const body = content.slice(lastIndex, m.index).trim();
            sections[lastTitle] = body;
        }
        lastTitle = m[1].trim();
        lastIndex = m.index + m[0].length;
    }
    if (lastTitle) {
        sections[lastTitle] = content.slice(lastIndex).trim();
    }
    const pick = (keys) => {
        for (const k of keys) {
            for (const title of Object.keys(sections)) {
                if (title.toLowerCase().includes(k.toLowerCase()))
                    return sections[title] ?? '';
            }
        }
        return '';
    };
    return {
        identity: pick(['identity', 'personality', 'role definition']),
        core_mission: pick(['core mission', 'mission', 'core capabilities']),
        critical_rules: pick(['critical rules', 'rules', 'decision framework']),
        workflow: pick(['workflow', 'process', 'specialized skills', 'success metrics']),
    };
}
const ROOT_SKIP = ['readme.md', 'contributing.md', 'license', 'design/', '.github/'];
function isAgentMarkdown(filePath) {
    const lower = filePath.toLowerCase();
    if (!lower.endsWith('.md'))
        return false;
    const inRoot = !filePath.includes('/');
    if (inRoot)
        return false;
    if (ROOT_SKIP.some((s) => lower.startsWith(s) || lower === s.replace(/\//, '')))
        return false;
    return true;
}
async function listAllMarkdownPaths() {
    const res = await axios_1.default.get(`${API_BASE}/git/trees/${GITHUB_BRANCH}`, { params: { recursive: 1 } });
    const tree = res.data?.tree ?? [];
    return tree
        .filter((node) => node.type === 'blob' && isAgentMarkdown(node.path))
        .map((n) => n.path);
}
async function fetchRawContent(filePath) {
    const url = `${RAW_BASE}/${encodeURIComponent(filePath)}`;
    const res = await axios_1.default.get(url, { responseType: 'text', timeout: 20000 });
    return res.data;
}
function parseMarkdownToRole(filePath, raw) {
    const { data: front, content } = (0, gray_matter_1.default)(raw);
    const division = divisionFromPath(filePath);
    const sections = splitSections(content);
    return {
        id: idFromPath(filePath),
        name: front.name ?? path.basename(filePath, '.md'),
        description: front.description ?? '',
        division,
        identity: sections.identity,
        core_mission: sections.core_mission,
        critical_rules: sections.critical_rules,
        workflow: sections.workflow,
        color: front.color,
        source_path: filePath,
        meta: front,
    };
}
async function main() {
    console.log('[sync-agency-agents] Listing .md files...');
    const paths = await listAllMarkdownPaths();
    console.log(`[sync-agency-agents] Found ${paths.length} markdown files.`);
    const roles = [];
    for (let i = 0; i < paths.length; i++) {
        const filePath = paths[i];
        try {
            const raw = await fetchRawContent(filePath);
            const role = parseMarkdownToRole(filePath, raw);
            roles.push(role);
            if ((i + 1) % 10 === 0)
                console.log(`  Parsed ${i + 1}/${paths.length}...`);
        }
        catch (e) {
            console.warn(`  Skip ${filePath}:`, e.message);
        }
    }
    const outDir = path.resolve(__dirname, '../database/seeds');
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }
    const outFile = path.join(outDir, 'synced-agency-agents.json');
    fs.writeFileSync(outFile, JSON.stringify(roles, null, 2), 'utf-8');
    console.log(`[sync-agency-agents] Wrote ${roles.length} roles to ${outFile}.`);
    const byDivision = roles.reduce((acc, r) => {
        acc[r.division] = (acc[r.division] ?? 0) + 1;
        return acc;
    }, {});
    console.log('[sync-agency-agents] By division:', byDivision);
    if (process.env.REDIS_HOST) {
        try {
            const Redis = require('ioredis');
            const redis = new Redis({
                host: process.env.REDIS_HOST ?? '127.0.0.1',
                port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
            });
            await redis.set('agent_roles:all', JSON.stringify(roles));
            await redis.quit();
            console.log('[sync-agency-agents] Upserted to Redis key agent_roles:all');
        }
        catch (e) {
            console.warn('[sync-agency-agents] Redis upsert skipped:', e.message);
        }
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=sync-agency-agents.js.map
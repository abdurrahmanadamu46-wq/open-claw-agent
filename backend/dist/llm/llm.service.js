"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LlmService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = __importDefault(require("axios"));
const NEW_API_BASE = process.env.NEW_API_BASE_URL ?? 'http://localhost:3001';
const NEW_API_TOKEN = process.env.NEW_API_TOKEN ?? '';
let LlmService = class LlmService {
    constructor() {
        this.client = axios_1.default.create({
            baseURL: NEW_API_BASE.replace(/\/$/, '') + '/v1',
            timeout: 120_000,
            headers: {
                'Content-Type': 'application/json',
                ...(NEW_API_TOKEN ? { Authorization: `Bearer ${NEW_API_TOKEN}` } : {}),
            },
        });
    }
    async chat(messages, options = {}) {
        const { data } = await this.client.post('/chat/completions', {
            model: options.model ?? 'gpt-4o-mini',
            messages,
            max_tokens: options.max_tokens ?? 2048,
            temperature: options.temperature ?? 0.7,
        });
        return data;
    }
    async chatContent(messages, options) {
        const result = await this.chat(messages, options);
        const content = result.choices?.[0]?.message?.content;
        return content ?? '';
    }
    isConfigured() {
        return !!NEW_API_BASE;
    }
};
exports.LlmService = LlmService;
exports.LlmService = LlmService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], LlmService);
//# sourceMappingURL=llm.service.js.map
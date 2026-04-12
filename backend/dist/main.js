"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.enableCors({ origin: true, credentials: true });
    const port = process.env.PORT ?? 38789;
    await app.listen(port);
    console.log(`C&C backend listening on http://localhost:${port}`);
    console.log(`WebSocket 龙虾网关: ws://localhost:${port}/lobster (激活码鉴权)`);
}
bootstrap();
//# sourceMappingURL=main.js.map
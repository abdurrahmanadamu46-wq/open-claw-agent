"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageAdapterStub = void 0;
class StorageAdapterStub {
    constructor() {
        this.name = 'storage-adapter-stub';
    }
    async getUploadPresignedUrl(config, fileName, _options) {
        const placeholder = `https://${config.bucketName}.${config.region}.example.com/upload?key=${encodeURIComponent(fileName)}&stub=1`;
        return {
            uploadUrl: placeholder,
            method: 'PUT',
            objectUrl: placeholder.replace('/upload?', '/'),
            headers: { 'Content-Type': 'video/mp4' },
        };
    }
}
exports.StorageAdapterStub = StorageAdapterStub;
//# sourceMappingURL=storage.adapter.js.map
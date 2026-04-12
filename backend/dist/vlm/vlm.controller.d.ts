export interface VlmAnalyzeDto {
    imageBase64: string;
}
export interface VlmAnalyzeResult {
    action: 'click' | 'type';
    x?: number;
    y?: number;
    text?: string;
    reason?: string;
}
export declare class VlmController {
    analyze(dto: VlmAnalyzeDto): VlmAnalyzeResult;
}

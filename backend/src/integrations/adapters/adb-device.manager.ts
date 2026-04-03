/**
 * 云手机 / ADB 设备管理 — App 端自动化扩展
 * 为未来手机 App 端抓取留出控制通道：连接设备、滑动等
 */

export interface AdbDeviceConnection {
  address: string;
  connected: boolean;
  /** 可选：设备型号/标签 */
  label?: string;
}

/**
 * ADB 设备管理接口：连接设备并执行滑动等操作
 */
export interface AdbDeviceManager {
  readonly name: string;

  /**
   * 连接指定 ADB 设备（网络地址或 USB 设备 ID）
   * @param adbAddress 如 '192.168.1.100:5555' 或 'usb-device-id'
   */
  connectDevice(adbAddress: string): Promise<AdbDeviceConnection>;

  /**
   * 在已连接设备上执行滑动（从 (x1,y1) 到 (x2,y2)）
   * 用于模拟手指滑动，配合 App 端自动化抓取
   */
  swipe(x1: number, y1: number, x2: number, y2: number, deviceAddress?: string): Promise<void>;

  /**
   * 可选：断开指定设备
   */
  disconnectDevice?(adbAddress: string): Promise<void>;
}

/**
 * 空壳实现：不执行真实 ADB 命令，生产替换为 adbkit 或云手机厂商 SDK
 */
export class AdbDeviceManagerStub implements AdbDeviceManager {
  readonly name = 'adb-device-manager-stub';

  async connectDevice(adbAddress: string): Promise<AdbDeviceConnection> {
    return { address: adbAddress, connected: true, label: 'stub' };
  }

  async swipe(_x1: number, _y1: number, _x2: number, _y2: number, _deviceAddress?: string): Promise<void> {
    // 生产实现：adb -s <device> shell input swipe x1 y1 x2 y2
  }
}

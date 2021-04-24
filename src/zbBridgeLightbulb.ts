import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
} from 'homebridge';

import { ZbBridgeAccessory } from './zbBridgeAccessory';
import { TasmotaZbBridgePlatform } from './platform';

export class ZbBridgeLightbulb extends ZbBridgeAccessory {
  private power?: CharacteristicValue;
  private dimmer?: CharacteristicValue;
  private ct?: CharacteristicValue;
  private hue?: CharacteristicValue;
  private saturation?: CharacteristicValue;
  private colorX?: CharacteristicValue;
  private colorY?: CharacteristicValue;

  private supportDimmer?: boolean;
  private supportCT?: boolean;
  private supportHS?: boolean;
  private supportXY?: boolean;

  constructor(
    readonly platform: TasmotaZbBridgePlatform,
    readonly accessory: PlatformAccessory,
  ) {
    super(platform, accessory);
  }

  getService(): Service {
    const service = this.platform.Service.Lightbulb;
    return this.accessory.getService(service) || this.accessory.addService(service);
  }

  configureLightFeatures() {
    if (this.type === 'light1' || this.type === 'light2' || this.type === 'light3' || this.type.includes('_B')) {
      this.supportDimmer = true;
    }
    if (this.type === 'light2' || this.type === 'light5' || this.type.includes('_CT')) {
      this.supportDimmer = true;
      this.supportCT = true;
    }
    if (this.type === 'light3' || this.type === 'light4' || this.type === 'light5' || this.type.includes('_HS')) {
      this.supportDimmer = true;
      this.supportHS = true;
    }
    if (this.type.includes('_XY')) {
      this.supportXY = true;
    }
  }

  registerHandlers() {
    this.configureLightFeatures();

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    if (this.supportDimmer) {
      this.service.getCharacteristic(this.platform.Characteristic.Brightness)
        .onSet(this.setBrightness.bind(this))
        .onGet(this.getBrightness.bind(this));
    }
    if (this.supportCT) {
      this.service.getCharacteristic(this.platform.Characteristic.ColorTemperature)
        .onSet(this.setColorTemperature.bind(this))
        .onGet(this.getColorTemperature.bind(this));
    }
    if (this.supportHS || this.supportXY) {
      this.service.getCharacteristic(this.platform.Characteristic.Hue)
        .onSet(this.setHue.bind(this))
        .onGet(this.getHue.bind(this));
      // register handlers for the Saturation Characteristic
      this.service.getCharacteristic(this.platform.Characteristic.Saturation)
        .onSet(this.setSaturation.bind(this))
        .onGet(this.getSaturation.bind(this));
    }
  }

  //uint8_t               colormode;      // 0x00: Hue/Sat, 0x01: XY, 0x02: CT | 0xFF not set, default 0x01

  //768/7 -> CT
  //768/8 -> colorMode

  //Info:   ZbSend {"Device": '0xC016', "Cluster": 0, "Read": [4,5]} // get Manufacturer, Model
  //Power:  ZbSend {"Device": "0x6769", "Cluster": 6, "Read": 0}
  //Dimmer: ZbSend {"Device": "0x6769", "Cluster": 8, "Read": 0}
  //Hue:    ZbSend {"Device": "0x6769", "Cluster": 768, "Read": 0}
  //Sat:    ZbSend {"Device": "0x6769", "Cluster": 768, "Read": 1}
  //HueSat: ZbSend {"Device": "0x6769", "Cluster": 768, "Read": [0,1]}
  //CT:     ZbSend {"Device": "0x6769", "Cluster": 768, "Read": 7}
  //ColorMode: ZbSend {"Device": "0xE12D", "Cluster": 768, "Read": 8}
  //Color:  ZbSend {"Device": "0xE12D", "Cluster": 768, "Read": [3,4  ]}
  //all:    Backlog ZbSend { "device": "0x6769", "cluster": 0, "read": [4,5] };
  //                ZbSend { "device": "0x6769", "cluster": 6, "read": 0 };
  //                ZbSend { "device": "0x6769", "cluster": 8, "read": 0 };
  //                ZbSend { "device": "0x6769", "cluster": 768, "read": [0, 1, 7] }

  onQueryInnitialState() {
    // query accessory information
    this.platform.mqttClient.send({ device: this.addr, cluster: 6, read: 0 });
    if (this.supportDimmer) {
      this.platform.mqttClient.send({ device: this.addr, cluster: 8, read: 0 });
    }
    if (this.supportCT) {
      this.platform.mqttClient.send({ device: this.addr, cluster: 768, read: [7, 8] });
    }
    if (this.supportHS) {
      this.platform.mqttClient.send({ device: this.addr, cluster: 768, read: [0, 1, 8] });
    }
    if (this.supportXY) {
      this.platform.mqttClient.send({ device: this.addr, cluster: 768, read: [3, 4, 8] });
    }
  }

  updateColor(colormode: number | undefined) {
    if (colormode === 2) {
      this.convertCTtoHS();
      if (this.ct !== undefined) {
        this.service.getCharacteristic(this.platform.Characteristic.ColorTemperature).updateValue(this.ct);
      }
    } else if (colormode === 1) {
      this.convertXYtoHS();
    }
    if (this.hue !== undefined) {
      this.service.getCharacteristic(this.platform.Characteristic.Hue).updateValue(this.hue);
    }
    if (this.saturation !== undefined) {
      this.service.getCharacteristic(this.platform.Characteristic.Saturation).updateValue(this.saturation);
    }
  }

  onStatusUpdate(response) {
    const colormode = response.ColorMode !== undefined ? response.ColorMode : this.supportXY ? 1 : 0;
    if (response.Power !== undefined) {
      this.power = (response.Power === 1);
      this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.power);
    }
    if (this.supportDimmer && response.Dimmer !== undefined) {
      this.dimmer = Math.round(100 * response.Dimmer / 254);
      this.service.getCharacteristic(this.platform.Characteristic.Brightness).updateValue(this.dimmer);
    }
    if (this.supportHS && response.Hue !== undefined) {
      this.hue = Math.round(360 * response.Hue / 254);
      this.updateColor(colormode);
    }
    if (this.supportHS && response.Sat !== undefined) {
      this.saturation = Math.round(100 * response.Sat / 254);
      this.updateColor(colormode);
    }
    if (this.supportXY && response.X !== undefined) {
      this.colorX = response.X;
      this.updateColor(colormode);
    }
    if (this.supportXY && response.Y !== undefined) {
      this.colorY = response.Y;
      this.updateColor(colormode);
    }
    if (this.supportCT && response.CT !== undefined) {
      this.ct = response.CT;
      this.updateColor(colormode);
    }

    this.log('%s%s%s%s%s%s%s%s',
      this.power !== undefined ? 'Power: ' + (this.power ? 'On' : 'Off') : '',
      this.supportDimmer && this.dimmer !== undefined ? ', Dimmer: ' + this.dimmer + '%' : '',
      colormode !== undefined ? ', colorMode: ' + colormode : '',
      this.supportHS && this.hue !== undefined ? ', Hue: ' + this.hue : '',
      this.supportHS && this.saturation !== undefined ? ', Saturation: ' + this.saturation : '',
      this.supportXY && this.colorX !== undefined ? ', X: ' + this.colorX : '',
      this.supportXY && this.colorY !== undefined ? ', Y: ' + this.colorY : '',
      this.supportCT && this.ct !== undefined ? ', CT: ' + this.ct : '',
    );
  }

  async setOn(value: CharacteristicValue) {
    if (this.power !== value) {
      this.power = value as boolean;
      this.updated = Date.now();
      if (this.powerTopic !== undefined) {
        this.platform.mqttClient.publish('cmnd/' + this.powerTopic, value ? 'ON' : 'OFF');
      } else {
        this.platform.mqttClient.send({ device: this.addr, send: { Power: (this.power ? 'On' : 'Off') } });
      }
    }
  }

  async getOn(): Promise<CharacteristicValue> {
    this.updated = undefined;
    if (this.power === undefined) {
      if (this.powerTopic !== undefined) {
        this.platform.mqttClient.publish('cmnd/' + this.powerTopic, '');
      } else {
        this.platform.mqttClient.send({ device: this.addr, cluster: 6, read: 0 });
      }
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return this.power;
  }

  setBrightness(value: CharacteristicValue) {
    if (this.dimmer !== value) {
      this.dimmer = value as number;
      this.updated = Date.now();
      this.platform.mqttClient.send({ device: this.addr, send: { Dimmer: Math.round(254 * this.dimmer / 100) } });
    }
  }

  async getBrightness(): Promise<CharacteristicValue> {
    this.updated = undefined;
    if (this.dimmer === undefined) {
      this.platform.mqttClient.send({ device: this.addr, cluster: 8, read: 0 });
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return this.dimmer;
  }

  async setColorTemperature(value: CharacteristicValue) {
    if (this.ct !== value) {
      this.ct = value as number;
      this.platform.mqttClient.send({ device: this.addr, send: { CT: this.ct } });
    }
  }

  async getColorTemperature(): Promise<CharacteristicValue> {
    this.updated = undefined;
    if (this.ct === undefined) {
      this.platform.mqttClient.send({ device: this.addr, cluster: 768, read: 0 });
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return this.ct;
  }

  async setHue(value: CharacteristicValue) {
    if (this.hue !== value) {
      this.hue = value as number;
      this.updated = Date.now();
      if (this.supportXY) {
        this.convertHStoXY();
        this.platform.mqttClient.send({ device: this.addr, send: { color: `${this.colorX},${this.colorY}` } });
      }
      if (this.supportHS) {
        this.platform.mqttClient.send({ device: this.addr, send: { Hue: Math.round(254 * this.hue / 360) } });
      }
    }
  }

  async getHue(): Promise<CharacteristicValue> {
    this.updated = undefined;
    if (this.hue === undefined) {
      if (this.supportXY) {
        this.platform.mqttClient.send({ device: this.addr, cluster: 768, read: [3, 4] });
      }
      if (this.supportHS) {
        this.platform.mqttClient.send({ device: this.addr, cluster: 768, read: 0 });
      }
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return this.hue;
  }

  async setSaturation(value: CharacteristicValue) {
    if (this.saturation !== value) {
      this.saturation = value as number;
      this.updated = Date.now();
      if (this.supportXY) {
        this.convertHStoXY();
        this.platform.mqttClient.send({ device: this.addr, send: { color: `${this.colorX},${this.colorY}` } });
      }
      if (this.supportHS) {
        this.platform.mqttClient.send({ device: this.addr, send: { Sat: Math.round(254 * this.saturation / 100) } });
      }
    }
  }

  async getSaturation(): Promise<CharacteristicValue> {
    this.updated = undefined;
    if (this.saturation === undefined) {
      if (this.supportXY) {
        this.platform.mqttClient.send({ device: this.addr, cluster: 768, read: [3, 4] });
      }
      if (this.supportHS) {
        this.platform.mqttClient.send({ device: this.addr, cluster: 768, read: 1 });
      }
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return this.saturation;
  }

  convertHStoXY() {
    if (this.hue === undefined || this.saturation === undefined) {
      return;
    }

    const h = (this.hue as number) / 360;
    const s = (this.saturation as number) / 100;

    let r = 1;
    let g = 1;
    let b = 1;

    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = 1 - s;
    const q = 1 - f * s;
    const t = 1 - (1 - f) * s;
    switch (i % 6) {
      case 0: g = t, b = p; break;
      case 1: r = q, b = p; break;
      case 2: r = p, b = t; break;
      case 3: r = p, g = q; break;
      case 4: r = t, g = p; break;
      case 5: g = p, b = q; break;
    }

    if (r + g + b > 0) {
      // apply gamma correction
      r = (r > 0.04045) ? Math.pow((r + 0.055) / (1.0 + 0.055), 2.4) : (r / 12.92);
      g = (g > 0.04045) ? Math.pow((g + 0.055) / (1.0 + 0.055), 2.4) : (g / 12.92);
      b = (b > 0.04045) ? Math.pow((b + 0.055) / (1.0 + 0.055), 2.4) : (b / 12.92);

      // Convert the RGB values to XYZ using the Wide RGB D65
      const X = r * 0.649926 + g * 0.103455 + b * 0.197109;
      const Y = r * 0.234327 + g * 0.743075 + b * 0.022598;
      const Z = r * 0.000000 + g * 0.053077 + b * 1.035763;

      this.colorX = Math.round(65535.0 * X / (X + Y + Z));
      this.colorY = Math.round(65535.0 * Y / (X + Y + Z));
      this.log(`HStoXY: ${this.hue},${this.saturation} -> ${this.colorX},${this.colorY}`);
    }
  }

  convertXYtoHS() {
    if (this.colorX === undefined || this.colorY === undefined) {
      return;
    }

    const x = (this.colorX as number) / 65535.0;
    const y = (this.colorY as number) / 65535.0;
    const z = 1.0 - x - y;

    const Y = this.dimmer === undefined ? 1 : (this.dimmer as number) / 100;
    const X = (Y / y) * x;
    const Z = (Y / y) * z;

    let r = X * 1.4628067 - Y * 0.1840623 - Z * 0.2743606;
    let g = -X * 0.5217933 + Y * 1.4472381 + Z * 0.0677227;
    let b = X * 0.0349342 - Y * 0.0968930 + Z * 1.2884099;
    // apply gamma correction
    r = r <= 0.0031308 ? 12.92 * r : (1.0 + 0.055) * Math.pow(r, (1.0 / 2.4)) - 0.055;
    g = g <= 0.0031308 ? 12.92 * g : (1.0 + 0.055) * Math.pow(g, (1.0 / 2.4)) - 0.055;
    b = b <= 0.0031308 ? 12.92 * b : (1.0 + 0.055) * Math.pow(b, (1.0 / 2.4)) - 0.055;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = (max === 0 ? 0 : d / max);

    switch (max) {
      case min: h = 0; break;
      case r: h = (g - b) + d * (g < b ? 6 : 0); h /= 6 * d; break;
      case g: h = (b - r) + d * 2; h /= 6 * d; break;
      case b: h = (r - g) + d * 4; h /= 6 * d; break;
    }

    this.hue = Math.round(h * 360);
    this.saturation = Math.round(s * 100);

    this.log(`XYtoHS: ${this.colorX},${this.colorY} -> ${this.hue},${this.saturation}`);
  }

  convertCTtoHS() {
    if (this.ct === undefined) {
      return;
    }
    const kelvin = 1000000 / (this.ct as number);
    let x, y;

    if (kelvin < 4000) {
      x = 11790 +
        57520658 / kelvin +
        -15358885888 / kelvin / kelvin +
        -17440695910400 / kelvin / kelvin / kelvin;
    } else {
      x = 15754 +
        14590587 / kelvin +
        138086835814 / kelvin / kelvin +
        -198301902438400 / kelvin / kelvin / kelvin;
    }
    if (kelvin < 2222) {
      y = -3312 +
        35808 * x / 0x10000 +
        -22087 * x * x / 0x100000000 +
        -18126 * x * x * x / 0x1000000000000;
    } else if (kelvin < 4000) {
      y = -2744 +
        34265 * x / 0x10000 +
        -22514 * x * x / 0x100000000 +
        -15645 * x * x * x / 0x1000000000000;
    } else {
      y = -6062 +
        61458 * x / 0x10000 +
        -96229 * x * x / 0x100000000 +
        50491 * x * x * x / 0x1000000000000;
    }
    y *= 4;
    x /= 0xFFFF;
    y /= 0xFFFF;

    this.colorX = Math.round(x * 65535.0);
    this.colorY = Math.round(y * 65535.0);
    this.log(`CTtoXY: ${this.ct} -> ${this.colorX},${this.colorY}`);
    this.convertXYtoHS();
  }

  HSVtoRGB(hue: number, saturation: number, brightness: number) {
    const h = hue / 360;
    const s = saturation / 100;
    const v = brightness / 100;
    let r = 1;
    let g = 1;
    let b = 1;
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = v * (1 - s);
    const q = v * (1 - f * s);
    const t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v, g = t, b = p; break;
      case 1: r = q, g = v, b = p; break;
      case 2: r = p, g = v, b = t; break;
      case 3: r = p, g = q, b = v; break;
      case 4: r = t, g = p, b = v; break;
      case 5: r = v, g = p, b = q; break;
    }
    return {
      r,
      g,
      b,
    };
  }

  RGBtoHSV(r: number, g: number, b: number) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    const s = (max === 0 ? 0 : d / max);
    const v = max / 255;

    switch (max) {
      case min: h = 0; break;
      case r: h = (g - b) + d * (g < b ? 6 : 0); h /= 6 * d; break;
      case g: h = (b - r) + d * 2; h /= 6 * d; break;
      case b: h = (r - g) + d * 4; h /= 6 * d; break;
    }

    return {
      hue: Math.round(h * 360),
      saturation: Math.round(s * 100),
      brightness: Math.round(v * 100),
    };
  }

}

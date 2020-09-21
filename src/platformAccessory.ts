import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';

import { ZbBridgePlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ZbBridgeAccessory {
  private service: Service;

  constructor(
    private readonly platform: ZbBridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .on('set', this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .on('get', this.getOn.bind(this));               // GET - bind to the `getOn` method below

    // register handlers for the Brightness Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.Brightness)
      .on('set', this.setBrightness.bind(this));       // SET - bind to the 'setBrightness` method below


    /**
     * Creating multiple services of the same type.
     * 
     * To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
     * when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
     * this.accessory.getService('NAME') || this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE_ID');
     * 
     * The USER_DEFINED_SUBTYPE must be unique to the platform accessory (if you platform exposes multiple accessories, each accessory
     * can use the same sub type id.)
     */

    // Example: add two "motion sensor" services to the accessory
    // const motionSensorOneService = this.accessory.getService('Motion Sensor One Name') ||
    //   this.accessory.addService(this.platform.Service.MotionSensor, 'Motion Sensor One Name', 'YourUniqueIdentifier-1');

    // const motionSensorTwoService = this.accessory.getService('Motion Sensor Two Name') ||
    //   this.accessory.addService(this.platform.Service.MotionSensor, 'Motion Sensor Two Name', 'YourUniqueIdentifier-2');

    /**
     * Updating characteristics values asynchronously.
     * 
     * Example showing how to update the state of a Characteristic asynchronously instead
     * of using the `on('get')` handlers.
     * Here we change update the motion sensor trigger states on and off every 10 seconds
     * the `updateCharacteristic` method.
     * 
     */
    // let motionDetected = false;
    // setInterval(() => {
    //   // EXAMPLE - inverse the trigger
    //   motionDetected = !motionDetected;

    //   // push the new value to HomeKit
    //   // motionSensorOneService.updateCharacteristic(this.platform.Characteristic.MotionDetected, motionDetected);
    //   // motionSensorTwoService.updateCharacteristic(this.platform.Characteristic.MotionDetected, !motionDetected);

    //   // this.platform.log.debug('Triggering motionSensorOneService:', motionDetected);
    //   // this.platform.log.debug('Triggering motionSensorTwoService:', !motionDetected);
    // }, 10000);
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  setOn(value: CharacteristicValue, callback: CharacteristicSetCallback) {

    // implement your own code to turn your device on/off

    const device = this.accessory.context.device.id;
    this.platform.log.info('setOn %s (%s):', this.accessory.context.device.name, device, value);
    this.platform.mqttClient.send({ device, send: { Power: (value ? 'On' : 'Off') } })
      .then((msg) => {
        this.platform.log.debug('ZbSend: %s', msg);
        callback(null);
      })
      .catch(err => {
        this.platform.log.error(err);
        callback(err);
      });
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   * 
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   * 
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  getOn(callback: CharacteristicGetCallback) {


    // implement your own code to check if the device is on
    // you must call the callback function
    // the first argument should be null if there were no errors
    // the second argument should be the value to return

    const device = this.accessory.context.device.id;
    this.platform.mqttClient.send({ device, cluster: 6, read: 0 })
      .then((msg) => {
        const power: number = msg.Power;
        const isOn = (power === 1);
        this.platform.log.info('getOn %s (%s):', this.accessory.context.device.name, device, isOn);
        callback(null, isOn);
      })
      .catch(err => {
        this.platform.log.error(err);
        callback(err);
      });
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, changing the Brightness
   */
  setBrightness(value: CharacteristicValue, callback: CharacteristicSetCallback) {

    // "getBrightness": {
    //   "topic": "tele/zbbridge/SENSOR",
    //   "apply": "let r=JSON.parse(message).ZbReceived['0x8FD1']; let d = r ? r.Dimmer : null; return d ? 100 * d / 254 : null"
    // },
    // "setBrightness": {
    //   "topic": "cmnd/zbbridge/zbsend",
    //   "apply": "return JSON.stringify({ Device: '0x8FD1', Send: { Dimmer: 254 * message / 100 }});"
    // }

    const device = this.accessory.context.device.id;
    this.platform.log.info('setBrightness %s (%s):', this.accessory.context.device.name, device, value);
    this.platform.mqttClient.send({ device, send: { Dimmer: Math.round(254 * (value as number) / 100) } })
      .then((msg) => {
        this.platform.log.debug('ZbSend: %s', msg);
        // you must call the callback function
        callback(null);
      })
      .catch(err => {
        this.platform.log.error(err);
        callback(err);
      });
  }

}

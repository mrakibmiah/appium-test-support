// transpile:mocha

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { stubEnv } from '../..';
import sinon from 'sinon';
import TestObject from '../lib/testobject';
import zip from '../lib/s3';
import * as teenProcess from 'teen_process';
const { usingTestObject, getTestObjectCaps, uploadTestObjectApp, overrideWD } = TestObject;
import { fs } from 'appium-support';

chai.should();
chai.use(chaiAsPromised);

describe('testobject-utils.js', function () {
  stubEnv();
  const appId = 1234;
  let uploadStub;
  beforeEach(function () {
    uploadStub = sinon.stub(TestObject, 'uploadTestObjectApp', () => appId);
  });

  afterEach(function () {
    uploadStub.restore();
  });

  describe('#getTestObjectCaps', function () {
    beforeEach(function () {
      delete process.env.TESTOBJECT_DEVICE;
    });
    it('should be rejected if call to uploadTestObjectApp is rejected', async function () {
      uploadStub.restore();
      uploadStub = sinon.stub(TestObject, 'uploadTestObjectApp', () => { throw new Error('Fake error'); });
      await getTestObjectCaps().should.eventually.be.rejectedWith(/Could not upload/);
    });
    it('should pass a cap with the TESTOBJECT_API_KEY and testobject_app_id in it', async function () {
      process.env.TESTOBJECT_API_KEY = 'foobar';
      const caps = await getTestObjectCaps();
      caps.testobject_api_key.should.equal(process.env.TESTOBJECT_API_KEY);
      caps.testobject_app_id.should.equal(appId);
    });
    it('should extend caps that were passed in', async function () {
      process.env.TESTOBJECT_API_KEY = 'c';
      const caps = await getTestObjectCaps({
        a: 'a',
        b: 'b',
      });
      caps.a.should.equal('a');
      caps.b.should.equal('b');
      caps.testobject_api_key.should.equal('c');
    });
    it('should set testobject_device to default device if no env variable is set', async function () {
      (await getTestObjectCaps()).testobject_device.should.equal(TestObject.DEFAULT_DEVICE);
    });
    it('should set testobject_device to default IOS device if no env variable is set and platformName is IOS', async function () {
      (await getTestObjectCaps({
        platformName: 'ios',
      })).testobject_device.should.equal(TestObject.DEFAULT_IOS_DEVICE);
    });
    it('should set testobject_device to process.env.TESTOBJECT_DEVICE', async function () {
      process.env.TESTOBJECT_DEVICE = 'fake_device';
      (await getTestObjectCaps()).testobject_device.should.equal('fake_device');
    });
  });

  describe('#uploadTestObjectApp', function () {
    let execStub, fsStatStub;
    beforeEach(function () {
      process.env.TESTOBJECT_USERNAME = 'foobar';
      process.env.TESTOBJECT_API_KEY = 1234;
      execStub = sinon.stub(teenProcess, 'exec', () => 1);
      fsStatStub = sinon.stub(fs, 'stat', () => ({
        mtime: +(new Date()) - 2 * 24 * 60 * 60 * 1000, // Pretend app was last modified 2 days ago
      }));
    });
    afterEach(function () {
      execStub.restore();
      fsStatStub.restore();
    });
    it('should be rejected if TESTOBJECT_USERNAME is not defined', async function () {
      process.env.TESTOBJECT_USERNAME = null;
      await uploadTestObjectApp().should.eventually.be.rejectedWith(/TESTOBJECT_USERNAME/);
    });
    it('should be rejected if TESTOBJECT_API_KEY not set', async function () {
      process.env.TESTOBJECT_API_KEY = null;
      await uploadTestObjectApp().should.eventually.be.rejectedWith(/TESTOBJECT_API_KEY/);
    });
    it('should be rejected if there is a network error', async function () {
      process.env.TESTOBJECT_USERNAME = 'foobar';
      await uploadTestObjectApp().should.eventually.equal(1);
    });
    it('should call cURL with -u and --data-binary args', async function () {
      execStub.restore();
      execStub = sinon.stub(teenProcess, 'exec', (command, args) => {
        command.should.equal('curl');
        args[1].should.equal('"foobar:1234"');
        args[args.length - 1].should.equal('@fakeapp.app');
      });
      await uploadTestObjectApp('fakeapp.app');
    });
    it('should re-use appId if app was already uploaded earlier', async function () {
      TestObject._appIdCache['fakeapp.app'] = {
        id: 2,
        uploaded: +(new Date()) - 24 * 60 * 60 * 1000,
      };
      await uploadTestObjectApp('fakeapp.app').should.eventually.equal(2);
      delete TestObject._appIdCache['fakeapp.app'];
    });
    it('should save uploaded app to cache', async function () {
      await uploadTestObjectApp('fakeapp.app');
      const cache = TestObject._appIdCache['fakeapp.app'];

      // Test that the cache recorded it being uploaded within the last 10 seconds 
      cache.uploaded.should.be.below(+(new Date()) + 1);
      cache.uploaded.should.be.above(+(new Date()) - 10000);
      cache.id.should.equal(1);
    });
    it('should re-upload app if app was modified after it was uploaded', async function () {
      TestObject._appIdCache['fakeapp.app'] = {
        id: 2,
        uploaded: +(new Date()) - 2 * 24 * 60 * 60 * 1000 - 1, // 2 days ago minus a millisecond
      };
      await uploadTestObjectApp('fakeapp.app').should.eventually.equal(1);
      TestObject._appIdCache['fakeapp.app'].id.should.equal(1);
    });
  });

  describe('#usingTestObject', function () {
    let uploadZipStub, deleteZipStub, Key, uploadedApp;

    before(function () {
      uploadZipStub = sinon.stub(zip, 'uploadZip', (app) => {
        uploadedApp = app;
        return {Key: 'fakeKey'};
      });
      deleteZipStub = sinon.stub(zip, 'deleteZip', (key) => {
        Key = key;
      });
    });

    usingTestObject(null, 'fakeapp.app');

    after(function () {
      Key.should.equal('fakeKey');
      uploadZipStub.restore();
      deleteZipStub.restore();
    });

    it('should call uploadZip on fake app provided', () => {
      uploadedApp.should.equal('fakeapp.app');
    });
  });

  describe('#overrideWD', function () {
    let initSpy, promiseChainRemoteSpy, MockWD;

    beforeEach(function () {
      initSpy = sinon.spy();
      promiseChainRemoteSpy = sinon.spy();

      MockWD = class MockWD {
        async init (caps) {
          initSpy(caps);
        }

        async promiseChainRemote (HOST, PORT) {
          promiseChainRemoteSpy(HOST, PORT);
        }
      };
      
    });

    it('should override wd.prototype.init', async function () {
      const mockWD = new MockWD();
      await mockWD.init({hello: 'world'});
      initSpy.firstCall.args.should.deep.equal([{hello: 'world'}]);
      overrideWD(MockWD);
      await mockWD.init({hello: 'whirl'});
      initSpy.secondCall.args[0].testobject_device.should.exist;
      initSpy.secondCall.args[0].hello.should.equal('whirl');
    });
    it('should override wd.prototype.promiseChainRemote', async function () {
      const mockWD = new MockWD();
      await mockWD.promiseChainRemote('HOST', 'PORT');
      promiseChainRemoteSpy.firstCall.args.should.deep.equal(['HOST', 'PORT']);
      overrideWD(MockWD);
      await mockWD.promiseChainRemote('HOST', 'PORT');
      promiseChainRemoteSpy.secondCall.args[0].should.equal(TestObject.HOST);
    });
  });
});
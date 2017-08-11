// transpile:mocha

import { fakeTime } from '..';

import chai from 'chai';
import sinon from 'sinon';
import B from 'bluebird';

chai.should();

function doSomething () {
  return new B.Promise((resolve) => {
    let ret = '';
    function appendOneByOne () {
      if (ret.length >= 10) {
        return resolve(ret);
      }
      setTimeout(() => {
        ret = ret + ret.length;
        appendOneByOne();
      }, 1000);
    }
    appendOneByOne();
  });
}

describe('time-utils', () => {
  describe('fakeTime', () => {
    let sandbox;
    beforeEach(() => {
      sandbox = sinon.sandbox.create();
    });
    afterEach(() => {
      sandbox.restore();
    });
    it('should fake time', async () => {
      let timeLord = fakeTime(sandbox);
      let p = doSomething();
      timeLord.speedup(200, 60);
      (await p).should.equals('0123456789');
    });
  });
});

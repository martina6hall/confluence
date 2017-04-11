// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
'use strict';

require('./failure_to_ship_data.es6.js');

foam.CLASS({
  package: 'org.chromium.apis.web',
  name: 'FailureToShip',
  extends: 'org.chromium.apis.web.MetricComputer',
  documentation: `FailureToShip is a class that computes the Failure
      To Ship metrics from browserApiDAO. It shows the number of APIs
      that available in other browsers for a year but is never available
      in this browser.`,
  requires: [
    'org.chromium.apis.web.Browser',
    'org.chromium.apis.web.WebInterface',
    'org.chromium.apis.web.BrowserWebInterfaceJunction',
    'org.chromium.apis.web.FailureToShipData',
    'foam.mlang.ExpressionsSingleton',
    'foam.dao.ArraySink',
    'foam.dao.EasyDAO',
  ],
  properties: [
    {
      name: 'failureToShipDAO',
      documentation: `This is a DAO that contains failureToShipData.`,
      final: true,
      factory: function() {
        return this.EasyDAO.create({
          name: 'failureToShipDAO',
          of: this.FailureToShipData,
          daoType: 'MDAO',
        });
      },
    },
  ],
  methods: [
    {
      name: 'compute',
      documentation: `Compute failure to ship value for each browser in
           browsers at the given date.`,
      args: [
        {
          name: 'browsers',
          typeName: 'org.chromium.apis.web.Browser[]',
          documentation: `An array of brwsers. These browser are either
              released at given date, or it is the most recent release
              before given date.`,
        },
        {
          name: 'date',
          typeName: 'Date',
          documentation: `The failure to ship value will be calculated at
              given date.`,
        },
      ],
      code: function(browsers, date) {
        for (let i = 0; i < browsers.length; i++) {
          let browser = browsers[i];
          let year = date.getFullYear();
          let month = date.getMonth();
          let day = date.getDate();
          let previousYear = new Date(year - 1, month, day);
          let browserKeys = browsers.map((browser) => browser.browserKey);
          // Find all browsers that
          //   - a previous version of the browser.
          //   - some other browser but released in previous one year range.
          //   - if no release in one year, uese most recent browser.
          this.browserDAO.where(this.mlang.OR(
              this.mlang.IN(this.Browser.BROWSER_KEY, browserKeys),
              this.mlang.AND(
                  this.mlang.EQ(this.Browser.BROWSER_NAME, browser.browserName),
                  this.mlang.EQ(this.Browser.OS_NAME, browser.osName),
                  this.mlang.GT(this.Browser.RELEASE_DATE, previousYear),
                  this.mlang.LT(this.Browser.RELEASE_DATE, date)),
              this.mlang.AND(
                  this.mlang.GT(this.Browser.RELEASE_DATE, previousYear),
                  this.mlang.LT(this.Browser.RELEASE_DATE, date))
              )).select().then((result) => {
            let browserIface = {};
            let numOtherBrowsers = 0;
            let majorIface = {};
            let promises = [];
            let prevReleaseBrowsers = [];
            let comparedBrowsers = [];
            for (let i = 0; i < result.a.length; i++) {
              if (result.a[i].browserName !== browser.browserName) {
                numOtherBrowsers++;
                comparedBrowsers.push(result.a[i]);
              } else if (result.a[i].browserKey !== browser.browserKey) {
                prevReleaseBrowsers.push(result.a[i]);
              }
              promises.push(result.a[i].interfaces.select({
                put: function(iface) {
                  if (result.a[i].browserName === browser.browserName) {
                    if (!browserIface.hasOwnProperty(iface.interfaceKey)) {
                      browserIface[iface.interfaceKey] = true;
                    }
                  } else {
                    if (!majorIface.hasOwnProperty(iface.interfaceKey)) {
                      majorIface[iface.interfaceKey] = 0;
                    }
                    majorIface[iface.interfaceKey]++;
                  }
                },
              }));
            }
            Promise.all(promises).then(() => {
              // Find interfaces that all other vendor's browsers supports
              // but not available in any version of this verndor's browsers.
              let numFailureToShip = 0;
              for (let ifaceKey in majorIface) {
                if (majorIface[ifaceKey] !== numOtherBrowsers) continue;
                if (!browserIface.hasOwnProperty(ifaceKey)) {
                  numFailureToShip++;
                }
              }
              this.failureToShipDAO.put(this.FailureToShipData.create(
                {
                  browserName: browser.browserName,
                  browser,
                  prevReleaseBrowsers,
                  comparedBrowsers,
                  numFailureToShip,
                  date,
                }));
            });
          });
        }
      },
    },
  ],
});
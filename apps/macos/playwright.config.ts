import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/e2e',workers:1,fullyParallel:false,use:{browserName:'webkit',launchOptions:process.env['TASKER_TEST_WEBKIT_EXECUTABLE']?{executablePath:process.env['TASKER_TEST_WEBKIT_EXECUTABLE']}:{},viewport:{width:420,height:588},screenshot:'only-on-failure'},timeout:30000});

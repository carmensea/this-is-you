import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

window.scrollTo = () => {};
// jsdom has no layout. Give charts a width so they actually render.
Element.prototype.getBoundingClientRect = () => ({ x:0, y:0, top:0, left:0, right:1000, bottom:400, width:1000, height:400, toJSON() {} });
afterEach(cleanup);

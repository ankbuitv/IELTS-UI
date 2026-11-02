import {describe,it,expect} from 'vitest';
import {filterRestorable} from '../../src/client/pages/schools/restore-window-filter';
describe('desktop window restore',()=>{
 it('only reopens permitted safe application IDs and removes duplicates',()=>{
  expect(filterRestorable(['notifications','admin-users','page','sessions','today','notifications',null],['notifications','page','sessions','today'])).toEqual(['notifications','today']);
 });
 it('ignores corrupted data',()=>expect(filterRestorable({ids:['today']},['today'])).toEqual([]));
});

import { FormData } from '../src';

describe('FormData', () => {
  it('should be exported from index', () => {
    const formData = new FormData();

    expect(formData).toBeDefined();
  });
});

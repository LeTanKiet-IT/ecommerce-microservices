export function createProductUseCases(repository) {
  return {
    listProducts() {
      return repository.findAll();
    },

    getProductById(id) {
      return repository.findById(id);
    },

    createProduct(data) {
      return repository.create(data);
    },

    updateProduct(id, data) {
      return repository.updateById(id, data);
    },

    deleteProduct(id) {
      return repository.deleteById(id);
    },
  };
}

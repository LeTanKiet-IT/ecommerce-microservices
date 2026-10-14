export function createMembershipUseCases(repository) {
  return {
    listTiers() {
      return repository.findAll();
    },

    getTierForScore(score) {
      return repository.findForScore(score);
    },

    createTier(data) {
      return repository.create(data);
    },

    updateTier(id, data) {
      return repository.updateById(id, data);
    },

    deleteTier(id) {
      return repository.deleteById(id);
    },
  };
}

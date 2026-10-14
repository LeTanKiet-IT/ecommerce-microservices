export function createCustomerUseCases({
  customerRepository,
  scoreRepository,
}) {
  return {
    createProfile(data) {
      return customerRepository.create(data);
    },

    getProfile(authUserId) {
      return customerRepository.findByAuthUserId(authUserId);
    },

    updateProfile(authUserId, data) {
      return customerRepository.updateProfile(authUserId, data);
    },

    adjustScore(data) {
      return scoreRepository.adjustScore(data);
    },

    getScoreHistory(authUserId) {
      return scoreRepository.findTransactionsByAuthUserId(authUserId);
    },
  };
}

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;

    // Function to generate a random 12-character alphanumeric string
    const generateSlug = (length = 12) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let result = '';
      for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    // If slug is not provided, generate one
    if (!data.slug) {
      data.slug = generateSlug();
    }
  },
};

const mongoose = require('mongoose');

const authTokenSchema = new mongoose.Schema({
  accessToken: {
    type: String,
    required: true
  },
  tokenType: {
    type: String,
    default: 'Bearer'
  },
  expiresAt: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Only keep the latest token
authTokenSchema.statics.getLatest = async function () {
  return this.findOne().sort({ createdAt: -1 });
};

authTokenSchema.statics.storeToken = async function (tokenData) {
  // Clear old tokens
  await this.deleteMany({});
  return this.create(tokenData);
};

module.exports = mongoose.model('AuthToken', authTokenSchema);

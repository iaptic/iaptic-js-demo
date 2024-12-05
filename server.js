const express = require('express');
const stripe = require('stripe')('sk_test_your_secret_key');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('.'));
app.use(express.json());

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 
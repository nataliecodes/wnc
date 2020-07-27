const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base('appwQnQN4iYL4GvTQ');

const getAllRequests = async (paymentMethods) => {
  try {
    let paymentFilter = 'OR(';

    if (Array.isArray(paymentMethods)) {
      paymentMethods.forEach((method, index) => {
        if (index === paymentMethods.length - 1) {
          paymentFilter += `{Payment Method}='${method}')`;
        } else {
          paymentFilter += `{Payment Method}='${method}', `;
        }
      });
    } else {
      paymentFilter = `{Payment Method}='${paymentMethods}'`;
    }

    const filter = {
      filterByFormula: paymentFilter,
    };

    const results = await base('Requests').select(filter).all();

    return results;
  } catch (e) {
    console.error(e);
  }
};

// // Add cumulative weight by treatment
// const treatmentsWithCumulativeWeight = treatments.reduce((accum, variant, idx) => {
//   if (idx === 0) {
//     return [{ ...variant, cumulativeWeight: variant.weight }];
//   }
//   const cumulativeWeight = accum[idx - 1].cumulativeWeight + variant.weight;
//   return [...accum, { ...variant, cumulativeWeight }];
// }, []);

// // Assign treatment based on random number and weight
// const randomNum = Math.random();
// const treatment = treatmentsWithCumulativeWeight.find((option) => {
//   return randomNum <= option.cumulativeWeight;
// });

module.exports = async (req, res) => {
  const { name = '', paymentMethods, amount, phoneNumber } = req.query;

  // check data 
  if (!paymentMethods || !amount || !phoneNumber) {
    // error
  }

  // get requests from the table
  const requests = await getAllRequests(paymentMethods);

  // get percentage of all money left for each request
  let totalRequestsAmount = 0;

  requests.forEach(request => {
    const requestAmount = request.get('Request Amount');

    totalRequestsAmount += requestAmount;
  });

  res.status(200).send(`Hello ${name}! Payment Methods: ${paymentMethods}, Amount: ${amount}, Phone: ${phoneNumber}`);
}
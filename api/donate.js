const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base('appwQnQN4iYL4GvTQ');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);

const cleanUpIncomingData = async (body) => {
  try {
    const { tableId, updates, recordId } = body[0];

    console.log('request body')
    console.log({ tableId }, { updates }, { recordId });

    // only handle updates to the requests table
    if (tableId !== process.env.AIRTABLE_REQUESTS_TABLE_ID) {
      console.log('ids do not match');
      console.log({ AIRTABLE_REQUESTS_TABLE_ID: process.env.AIRTABLE_REQUESTS_TABLE_ID });
      return {};
    }

    // check data 
    let amount = 0;
    let name = '';
    let paymentMethods = [];
    let phoneNumber = '';

    // TODO there is definitely a better way to do this
    updates.forEach(({ field, newValue }) => {
      if (field === 'Name') {
        name = newValue;
      }
      if (field === 'Payment methods') {
        paymentMethods = newValue.split(', ');
      }
      if (field === 'Phone') {
        if (newValue.substring(0, 5) === '<tel:') {
          phoneNumber = newValue.substring(5, 18);
        } else {
          phoneNumber = newValue;
        }
      }
      if (field === 'Contribution') {
        amount = newValue;
      }
    });

    return { amount, name, paymentMethods, phoneNumber, donationId: recordId };
  } catch (e) {
    console.error(e);
    return e;
  }
}

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

    const results = await base(process.env.AIRTABLE_REQUESTS_TABLE).select(filter).all();

    return results;
  } catch (e) {
    console.error(e);
  }
};

const getTotalRequestAmount = async (requests) => {
  try {
    let totalRequestsAmount = 0;

    requests.forEach(request => {
      const requestAmount = request.get('Request Amount');

      totalRequestsAmount += requestAmount;
    });

    return totalRequestsAmount;
  } catch (e) {
    console.error(e);
  }
}

const getTreatments = async (requests, totalRequestsAmount) => {
  try {
    const treatments = [];

    requests.forEach(request => {
      const amountLeft = request.get('Amount To Raise');
      // IMPORTANT: total weight must = 1, which is why we're leaving these as decimals < 1
      const weight = amountLeft / totalRequestsAmount;

      treatments.push({ value: request.id, weight, request });
    });

    return treatments;
  } catch (e) {
    console.error(e);
  }
}

const getTreatmentBasedOnWeight = async (treatments) => {
  try {
    // Add cumulative weight by treatment
    const treatmentsWithCumulativeWeight = treatments.reduce((accum, variant, idx) => {
      if (idx === 0) {
        return [{ ...variant, cumulativeWeight: variant.weight }];
      }
      const cumulativeWeight = accum[idx - 1].cumulativeWeight + variant.weight;
      return [...accum, { ...variant, cumulativeWeight }];
    }, []);

    // Assign treatment based on random number and weight
    const randomNum = Math.random();
    const treatment = treatmentsWithCumulativeWeight.find((option) => {
      return randomNum <= option.cumulativeWeight;
    });

    return treatment;
  } catch (e) {
    console.error(e);
  }
}

const getPaymentMethod = async (request, paymentMethods) => {
  try {
    const requestorMethods = request.get('Payment Method');

    let paymentMethod = '';

    for (let i = 0; i < requestorMethods.length; i++) {
      const method = requestorMethods[i];

      if (paymentMethods.indexOf(method) > -1) {
        paymentMethod = method;
        break;
      }
    }

    return paymentMethod;
  } catch (e) {
    console.error(e);
  }
}

const getPaymentUrl = async (paymentMethod, request, name, amount) => {
  try {
    let url = '';

    if (paymentMethod === 'CashApp') {
      // format is entire cashapp URL
      url = request.get('CashApp username');
    } else if (paymentMethod === 'Zelle') {
      // format is just a phone number or email
      const emailOrPhone = request.get('Zelle Email or Phone Number');
      url = `${emailOrPhone} on https://www.zellepay.com/`;
    } else if (paymentMethod === 'Paypal') {
      // format is just a phone number or email
      const emailOrPhone = request.get('PayPal Email or Phone Number')
      url = `${emailOrPhone} on https://www.paypal.com/myaccount/transfer/homepage/pay`;
    } else if (paymentMethod === 'Venmo') {
      // format is entire venmo URL
      url = request.get('Venmo username');
    }

    return url;
  } catch (e) {
    console.error(e);
  }
}

const sendTextMessage = async (phoneNumber, name, amount, platformUrl) => {
  try {
    return client.studio.v1.flows(process.env.TWILIO_FLOW_ID)
      .executions
      .create({
        parameters: {
          name,
          amount,
          platformUrl,
        }, to: phoneNumber, from: process.env.TWILIO_PHONE_NUMBER
      })
      .then(execution => {
        return execution.sid;
      });
  } catch (e) {
    console.error(e);
    return e;
  }
}

const updateAirtableRecord = async (id, donationId) => {
  try {
    const currentRecord = await base(process.env.AIRTABLE_REQUESTS_TABLE).find(id);
    const donors = await currentRecord.get('Donors') || [];

    donors.push(donationId);

    const updatedRecord = await base(process.env.AIRTABLE_REQUESTS_TABLE).update(id, { Donors: donors });

    return updatedRecord;
  } catch (e) {
    console.error(e);
    return e;
  }
};

module.exports = async (req, res) => {
  // get all the data off the request in the format we want
  const { amount, name, paymentMethods, phoneNumber, donationId } = await cleanUpIncomingData(req.body);

  // if it's not the right table or fields are missing, return 
  if (!amount || !name || !paymentMethods || !phoneNumber || !donationId) {
    console.log('error state: all calculated inputs');
    console.log({ amount });
    console.log({ name });
    console.log({ paymentMethods });
    console.log({ phoneNumber });
    console.log({ donationId });

    res.status(500).send('One or more fields is missing or the wrong table is being updated');
    return;
  }

  // get requests from the table
  const requests = await getAllRequests(paymentMethods);

  console.log('filtered requests');
  console.log({ requests });

  // ERROR / EDGE CASE HANDLING
  // if no requests come back, aka no one who needs money currently aligns with your payment method,
  // OR all donation requests have been met (WOO!)
  if (requests.length === 0) {
    // send text that either no one matches the payment option you provided or all donations have been met
    res.status(500).send('Payment methods do not match or all donations have been met');
    return;
  }

  // get total money to be spent
  const totalRequestsAmount = await getTotalRequestAmount(requests);

  // get an array of each ID with weight based on how much money they have left to donate
  const treatments = await getTreatments(requests, totalRequestsAmount);

  // get random treatment based on weight
  const treatment = await getTreatmentBasedOnWeight(treatments);

  // get request off of that treatment
  const { request } = treatment;

  // get payment method(s) from request
  const paymentMethod = await getPaymentMethod(request, paymentMethods);

  // get text to send via twilio
  const paymentUrl = await getPaymentUrl(paymentMethod, request, name, amount);

  console.log('payment URL/text');
  console.log({ paymentUrl });

  // send message via Twilio
  const messageResponse = await sendTextMessage(phoneNumber, name, amount, paymentUrl);

  console.log('respone from starting flow in twilio');
  console.log({ messageResponse });

  // if no error, update airtable
  if (!messageResponse.errorMessage) {
    // update airtable
    console.log('success sending twilio!');

    const updatedRecord = await updateAirtableRecord(request.id, donationId);
    const name = updatedRecord.get('Name');

    res.status(200).send(`Success! Message success id number: ${messageResponse.sid}. Record updated: ${request.id}, name: ${name}`);
  } else {
    res.status(500).send('There was an error sending the text via Twilio. Check twilio logs.');
  }
}
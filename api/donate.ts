const AirtableClass = require('airtable');
const base = new AirtableClass({ apiKey: process.env.AIRTABLE_API_KEY }).base('appwQnQN4iYL4GvTQ');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);

type MessageBody = {
  recordId: string,
  tableId: string,
  updates: any[],
}[];

type MessageData = {
  amount: number,
  name: string,
  paymentMethods: PaymentMethod[],
  phoneNumber: string,
  donationId: string,
};

type PaymentMethod = 'CashApp' | 'Venmo' | 'Paypal' | 'Zelle';

type RequestRecord = {
  id: string,
  fields: {},
  get: (property: string) => any;
};

type Treatment = {
  value: string,
  weight: string,
  request: RequestRecord,
};

const sendErrorToAirtable = async (e, donorName) => {
  console.error(e);

  const errorField = (e && e.status) ? e.status.toString() : 'general error name';
  const errorMessage = (e && e.message) ? e.message : 'general error message';

  await base(process.env.AIRTABLE_ERRORS_TABLE).create([
    {
      'fields': {
        'Error': errorField,
        'Error message': errorMessage,
        'Donor name': donorName,
      }
    }
  ]);
}

const cleanUpIncomingData = async (body: MessageBody): Promise<MessageData[]> => {
  let name = '';

  try {
    const recordUpdates = [];

    body.forEach(update => {
      const { tableId, updates, recordId } = update;

      // only handle updates to the requests table
      if (tableId !== process.env.AIRTABLE_REQUESTS_TABLE_ID) {
        console.log('ids do not match');
        console.log({ AIRTABLE_REQUESTS_TABLE_ID: process.env.AIRTABLE_REQUESTS_TABLE_ID });
        return;
      }

      // check data 
      let amount = 0;
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

      recordUpdates.push({ amount, name, paymentMethods, phoneNumber, donationId: recordId });
    });


    return recordUpdates;
  } catch (e) {
    await sendErrorToAirtable(e, name);
  }
}

const getAllRequests = async (paymentMethods: PaymentMethod[], name: string): Promise<RequestRecord[]> => {
  try {
    let paymentFilter = 'AND({Status}!="Funded", OR(';

    paymentMethods.forEach((method, index) => {
      if (index === paymentMethods.length - 1) {
        paymentFilter += `{Payment Method}='${method}'))`;
      } else {
        paymentFilter += `{Payment Method}='${method}', `;
      }
    });

    const filter = {
      filterByFormula: paymentFilter,
    };

    const results = await base(process.env.AIRTABLE_REQUESTS_TABLE).select(filter).all();

    return results;
  } catch (e) {
    sendErrorToAirtable(e, name);
  }
};

const getRandomRequest = async (requests: RequestRecord[], name: string): Promise<RequestRecord> => {
  try {
    const randomIndex = Math.floor(Math.random() * requests.length);

    return requests[randomIndex];
  } catch (e) {
    sendErrorToAirtable(e, name);
  }
}

const getRequestsForAmount = async (requests: RequestRecord[], amount: string, name: string): Promise<RequestRecord[]> => {
  try {
    const donationAmount = parseInt(amount.slice(1, amount.length));
    let donorAmountLeft = donationAmount;

    const finalRequests = [];

    while (donorAmountLeft > 0) {
      // get a random request from the table
      const request = await getRandomRequest(requests, name);

      finalRequests.push(request);

      // find the index of the chosen request
      const foundIndex = requests.findIndex(foundRequest => foundRequest.id === request.id);

      // remove it from the requests array
      for (let i = 0; i < requests.length; i++) {
        if (i === foundIndex) {
          requests.splice(i, 1);
        }
      }
      // check amount to see if donation amount is more than this one request needs
      // make sure we're comparing two ints
      const amountLeftToRaise = request.get('Amount To Raise');

      donorAmountLeft -= amountLeftToRaise;
    }

    return finalRequests;
  } catch (e) {
    sendErrorToAirtable(e, name);
  }
}

const getPaymentMethod = async (requestPaymentMethods: PaymentMethod[], paymentMethods: PaymentMethod[], name: string): Promise<PaymentMethod> => {
  try {
    let paymentMethod = '' as PaymentMethod;

    for (let i = 0; i < requestPaymentMethods.length; i++) {
      const method = requestPaymentMethods[i];

      if (paymentMethods.indexOf(method) > -1) {
        paymentMethod = method;
        break;
      }
    }

    return paymentMethod;
  } catch (e) {
    sendErrorToAirtable(e, name);
  }
}

const getPaymentUrl = async (paymentMethod: PaymentMethod, request: RequestRecord, name: string): Promise<string> => {
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
    sendErrorToAirtable(e, name);
  }
}

const updateAirtableRecord = async (id: string, donationId: string, name: string): Promise<RequestRecord> => {
  try {
    const currentRecord = await base(process.env.AIRTABLE_REQUESTS_TABLE).find(id);
    const donors = await currentRecord.get('Donors') || [];

    donors.push(donationId);

    const updatedRecord = await base(process.env.AIRTABLE_REQUESTS_TABLE).update(id, { Donors: donors });

    return updatedRecord;
  } catch (e) {
    sendErrorToAirtable(e, name);
  }
};

const matchDonorAndSendText = async (donationRequest, res) => {
  const { amount, name, paymentMethods, phoneNumber, donationId } = donationRequest;

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
  const requests = await getAllRequests(paymentMethods, name);

  // ERROR / EDGE CASE HANDLING
  // if no requests come back, aka no one who needs money currently aligns with your payment method,
  // OR all donation requests have been met (WOO!)
  if (requests.length === 0) {
    sendErrorToAirtable('Payment methods do not match or all donations have been met', name);
    // send text that either no one matches the payment option you provided or all donations have been met
    res.status(500).send('Payment methods do not match or all donations have been met');
    return;
  }

  // get all possible requests (could be none, 1 or +);
  const finalRequests = await getRequestsForAmount(requests, amount, name);
  let totalDonated = 0;

  console.log('---');
  console.log({ finalRequests });
  console.log('---');

  if (finalRequests.length === 0) {
    // waiting on how we want to handle this
    return;
  }

  try {
    await finalRequests.forEach(async request => {
      // get payment method(s) from request
      const requestPaymentMethods = request.get('Payment Method');
      const paymentMethod = await getPaymentMethod(requestPaymentMethods, paymentMethods, name);

      // get text to send via twilio
      const paymentUrl = await getPaymentUrl(paymentMethod, request, name);

      let requestDonationAmount = '';
      // get amount left for that request to know if it's less than the amount donor has suggested
      const amountLeftToRaise = request.get('Amount To Raise');
      // get amount for the donor
      const donationAmount = parseInt(amount.slice(1, amount.length));

      // get proper amount
      if (amountLeftToRaise < donationAmount) {
        totalDonated += amountLeftToRaise;
        requestDonationAmount = `$${amountLeftToRaise}.00`;
      } else {
        requestDonationAmount = `$${donationAmount - totalDonated}.00`;
      }

      console.log('---');
      console.log('about to send twilio');
      console.log('---');

      // send message via Twilio
      return client.studio.v1.flows(process.env.TWILIO_FLOW_ID)
        .executions
        .create({
          parameters: {
            name,
            amount: requestDonationAmount,
            platformUrl: paymentUrl,
          }, to: phoneNumber, from: process.env.TWILIO_PHONE_NUMBER
        })
        .then(async response => {
          console.log('---start twilio response---');
          console.log({ response });
          console.log('---end twilio response---');

          console.log('success sending twilio!');
          const updatedRecord = await updateAirtableRecord(request.id, donationId, name);
          console.log(`Record updated! Name: ${updatedRecord.get('Name')}.`);
        })
        .catch(error => {
          sendErrorToAirtable(error, name);
          return;
        });
    });
  } catch (e) {
    sendErrorToAirtable(e, name);
    res.status(500).send('Error sending to Twilio.');
  }

  setTimeout(() => {
    res.status(200).send('Worked!');
  }, 5000);
}

module.exports = async (req, res) => {
  // get all the data off the request in the format we want
  const donationRequests = await cleanUpIncomingData(req.body);

  donationRequests.forEach(async donationRequest => {
    await matchDonorAndSendText(donationRequest, res);
  });
}
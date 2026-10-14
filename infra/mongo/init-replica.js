const config = {
  _id: "rs0",
  members: [
    {
      _id: 0,
      host: "product-db:27017"
    }
  ]
};

printjson(rs.initiate(config));

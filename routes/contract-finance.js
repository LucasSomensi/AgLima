function grossValueSql(quantity, price) {
  return `ROUND((${quantity}) * (${price}) / 60, 2)`;
}

function senarDiscountSql(quantity, price, deductsSenar) {
  return `(CASE WHEN ${deductsSenar} THEN ROUND(${grossValueSql(quantity, price)} * 0.002, 2) ELSE 0 END)`;
}

function netValueSql(quantity, price, deductsSenar) {
  return `(${grossValueSql(quantity, price)} - ${senarDiscountSql(quantity, price, deductsSenar)})`;
}

function contractNetValueSql(alias) {
  return netValueSql(`${alias}.quantidade_kg`, `${alias}.preco_por_saca`, `${alias}.desconta_senar`);
}

module.exports = { contractNetValueSql, grossValueSql, netValueSql, senarDiscountSql };

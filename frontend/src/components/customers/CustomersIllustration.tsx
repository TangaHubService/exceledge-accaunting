/**
 * Hero illustration from the Customers & leads mock.
 * Uses the cropped mock artwork as-is (woman with glasses + plant).
 */
export function CustomersIllustration() {
  return (
    <div className="ee-cust-illu" aria-hidden="true">
      <img
        className="ee-cust-illu-person"
        src="/illustrations/customers-hero.png"
        alt=""
        width={349}
        height={199}
        decoding="async"
      />
    </div>
  );
}

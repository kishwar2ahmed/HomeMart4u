require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding Fresh Chicken & HomeMart4U platform database...");

  // 1. Clean existing records if any
  await prisma.bankTransaction.deleteMany();
  await prisma.review.deleteMany();
  await prisma.couponRedemption.deleteMany();
  await prisma.deliveryAssignment.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.favorite.deleteMany();
  await prisma.address.deleteMany();
  await prisma.deliveryAgentProfile.deleteMany();
  await prisma.customizationOption.deleteMany();
  await prisma.customizationGroup.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.coupon.deleteMany();
  await prisma.systemSetting.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.notificationBroadcast.deleteMany();
  await prisma.notificationSubscription.deleteMany();
  await prisma.user.deleteMany();

  // 2. Hash default passwords
  const adminRawPassword = process.env.ADMIN_PASSWORD || "Mian@0071";
  const adminMobile = process.env.ADMIN_MOBILE || "7022461700";
  const adminEmail = process.env.ADMIN_EMAIL || "admin@homemart4u.in";
  const adminPass = await bcrypt.hash(adminRawPassword, 10);

  // 3. Create Users
  await prisma.user.create({
    data: {
      name: "Admin (HomeMart4U)",
      mobile: adminMobile,
      email: adminEmail,
      passwordHash: adminPass,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  console.log("Seeded User: Admin (HomeMart4U)");

  // 4. Create System Settings
  const settings = [
    { key: "SHOP_NAME", value: "homemart4u", description: "Official Business Name" },
    { key: "SHOP_PHONE", value: "+91 90355 26638", description: "Customer Support Contact" },
    { key: "SHOP_ADDRESS", value: "Srinivaspur Road, Mulbagal 563131", description: "Storefront Address" },
    { key: "SHOP_LAT", value: "13.1645", description: "Latitude coordinates of shop" },
    { key: "SHOP_LNG", value: "78.3952", description: "Longitude coordinates of shop" },
    { key: "shop_name", value: "homemart4u", description: "Official Business Name" },
    { key: "shop_phone", value: "+91 90355 26638", description: "Customer Support Contact" },
    { key: "shop_address", value: "Srinivaspur Road, Mulbagal 563131", description: "Storefront Address" },
    { key: "shop_email", value: "support.homemart4u@gmail.com", description: "Store Support Email" },
    { key: "FREE_DELIVERY_METERS", value: "3000", description: "First 3km free threshold" },
    { key: "free_delivery_radius_meters", value: "3000", description: "First 3km free threshold" },
    { key: "DELIVERY_RATE_PER_100M_PAISE", value: "150", description: "₹1.50 per 100m beyond 3km" },
    { key: "delivery_rate_per_100m_paise", value: "150", description: "₹1.50 per 100m beyond 3km" },
    { key: "COD_FEE_PAISE", value: "700", description: "COD Surcharge: ₹7.00" },
    { key: "cod_surcharge_paise", value: "700", description: "COD Surcharge: ₹7.00" },
    { key: "MIN_QUALIFYING_MEAT_GRAMS", value: "0", description: "Minimum order threshold (0 = no restriction)" },
    { key: "minimum_order_meat_grams", value: "0", description: "Minimum order threshold" },
    { key: "TARGET_DELIVERY_MINUTES", value: "20", description: "Approximate delivery target window" },
    { key: "ORDER_SIMULATION_ENABLED", value: "false", description: "Development order lifecycle simulation flag" },
    { key: "UPI_VPA", value: "9844797374@mbk", description: "Merchant UPI VPA ID for app intent payments" },
    { key: "UPI_MERCHANT_NAME", value: "homemart4u", description: "Payee Name displayed in Google Pay / PhonePe / Paytm" },
  ];

  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { value: s.value, description: s.description },
      create: s,
    });
  }
  console.log("Seeded System Settings");

  // 5. Create Categories (Department: MEAT and GROCERY)
  const categoryDefs = [
    {
      name: "Fresh Chicken",
      slug: "fresh-chicken",
      department: "MEAT",
      description: "Farm fresh, hygienic, tender chicken cut to your preference daily.",
      imageUrl: "/images/products/fresh-tender-chicken-curry-cut.jpg",
      displayOrder: 1,
    },
    {
      name: "Masala & Special Cuts",
      slug: "masala-special",
      department: "MEAT",
      description: "Chef-curated marinated chicken, fresh kebab cuts, and signature masala preparations.",
      imageUrl: "/images/products/chef-special-marinated-chicken-kebab.jpg",
      displayOrder: 2,
    },
    {
      name: "Farm & Desi Eggs",
      slug: "eggs",
      department: "MEAT",
      description: "Nutritious, naturally raised country desi eggs and daily fresh farm eggs.",
      imageUrl: "/images/products/pure-country-desi-nati-eggs.jpg",
      displayOrder: 3,
    },
    {
      name: "Fish & Seafood",
      slug: "fish-seafood",
      department: "MEAT",
      description: "Fresh coastal catches, freshwater fish, prawns & crabs arriving soon to Mulbagal.",
      imageUrl: "/images/products/fresh-rohu-catla-curry-cut.jpg",
      displayOrder: 4,
    },
    {
      name: "Chilled Beverages",
      slug: "beverages",
      department: "MEAT",
      description: "Refreshing cold beverages to complete your dining experience.",
      imageUrl: "/images/products/thums-up-750ml.jpg",
      displayOrder: 5,
    },
    {
      name: "Fresh Mutton & Lamb",
      slug: "fresh-mutton",
      department: "MEAT",
      description: "Tender farm-raised goat meat, succulent curry cuts, and rich biryani pieces coming soon to Mulbagal.",
      imageUrl: "/images/products/tender-goat-curry-cut.jpg",
      displayOrder: 6,
    },
    {
      name: "Dairy, Eggs & Bread",
      slug: "dairy-eggs-bread",
      department: "GROCERY",
      description: "Daily fresh milk, butter, paneer, curd, farm brown eggs, and soft sliced breads.",
      imageUrl: "/images/products/nandini-fresh-toned-milk.jpg",
      displayOrder: 10,
    },
    {
      name: "Atta, Rice & Dals",
      slug: "atta-rice-dal",
      department: "GROCERY",
      description: "Premium chakki atta, aged basmati rice, sona masoori, and unpolished protein-rich pulses.",
      imageUrl: "/images/products/india-gate-super-basmati-rice.jpg",
      displayOrder: 11,
    },
    {
      name: "Cooking Oils & Desi Ghee",
      slug: "oils-ghee",
      department: "GROCERY",
      description: "Refined sunflower oils, cold-pressed mustard oil, and pure aromatic desi cow ghee.",
      imageUrl: "/images/products/fortune-sunlite-sunflower-oil.jpg",
      displayOrder: 12,
    },
    {
      name: "Masalas & Spices",
      slug: "spices-masalas",
      department: "GROCERY",
      description: "Authentic chicken masala, biryani spices, pure turmeric, red chilli, and ginger garlic paste.",
      imageUrl: "/images/products/everest-chicken-masala.jpg",
      displayOrder: 13,
    },
    {
      name: "Fresh Vegetables",
      slug: "fresh-vegetables",
      department: "GROCERY",
      description: "Fresh red onions, juicy tomatoes, farm potatoes, crisp green chillies, and fresh herbs.",
      imageUrl: "/images/products/fresh-red-onions.jpg",
      displayOrder: 14,
    },
    {
      name: "Tea, Coffee & Beverages",
      slug: "tea-beverages",
      department: "GROCERY",
      description: "Premium gold tea, roasted filter coffee, energy drinks, and packaged mineral waters.",
      imageUrl: "/images/products/tata-tea-gold.jpg",
      displayOrder: 15,
    },
  ];

  const catMap = {};
  for (const c of categoryDefs) {
    const cat = await prisma.category.create({ data: c });
    catMap[c.slug] = cat;
  }
  console.log("Seeded 12 Categories across MEAT & GROCERY departments");

  // Chicken Customization Groups
  const chickenCustomizationGroups = [
    {
      name: "Cutting Preference",
      selectionType: "SINGLE",
      isRequired: true,
      displayOrder: 1,
      options: [
        { name: "Curry Cut (Medium)", priceDeltaMinor: 0, displayOrder: 1 },
        { name: "Small Pieces (Biryani Cut)", priceDeltaMinor: 0, displayOrder: 2 },
        { name: "Large Pieces", priceDeltaMinor: 0, displayOrder: 3 },
      ],
    },
    {
      name: "Skin Preference",
      selectionType: "SINGLE",
      isRequired: true,
      displayOrder: 2,
      options: [
        { name: "Skinless (Healthier)", priceDeltaMinor: 0, displayOrder: 1 },
        { name: "With Skin (More Flavor)", priceDeltaMinor: 0, displayOrder: 2 },
      ],
    },
  ];

  // 6. Create Fresh Chicken Products
  const chickenProducts = [
    {
      categoryId: catMap["fresh-chicken"].id,
      name: "Fresh Tender Chicken Curry Cut",
      slug: "fresh-tender-chicken-curry-cut",
      description: "Tender, succulent bone-in chicken cuts perfect for rich, flavorful curries and gravies.",
      productType: "WEIGHT",
      isHalal: true,
      foodType: "NON_VEG",
      isAvailable: true,
      imageUrl: "/images/products/fresh-tender-chicken-curry-cut.jpg",
      displayOrder: 1,
      variants: {
        create: [
          { name: "500g Pack", pricingType: "WEIGHT", quantityValue: 500, quantityUnit: "g", priceMinor: 14000, isAvailable: true },
          { name: "1kg Family Pack", pricingType: "WEIGHT", quantityValue: 1000, quantityUnit: "g", priceMinor: 26000, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["fresh-chicken"].id,
      name: "Premium Boneless Chicken Breast",
      slug: "premium-boneless-chicken-breast",
      description: "Lean, tender, protein-rich chicken breast fillets. Ideal for fitness enthusiasts, grilling, and salads.",
      productType: "WEIGHT",
      isHalal: true,
      foodType: "NON_VEG",
      isAvailable: true,
      imageUrl: "/images/products/premium-boneless-chicken-breast.jpg",
      displayOrder: 2,
      variants: {
        create: [
          { name: "500g Pack", pricingType: "WEIGHT", quantityValue: 500, quantityUnit: "g", priceMinor: 19000, isAvailable: true },
          { name: "1kg Family Pack", pricingType: "WEIGHT", quantityValue: 1000, quantityUnit: "g", priceMinor: 36000, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["fresh-chicken"].id,
      name: "Juicy Chicken Drumsticks",
      slug: "juicy-chicken-drumsticks",
      description: "Tender, juicy chicken leg drumsticks. Perfect for barbecues, tandoori, or biryani.",
      productType: "WEIGHT",
      isHalal: true,
      foodType: "NON_VEG",
      isAvailable: true,
      imageUrl: "/images/products/juicy-chicken-drumsticks.jpg",
      displayOrder: 3,
      variants: {
        create: [
          { name: "4 Pieces (~400g)", pricingType: "WEIGHT", quantityValue: 400, quantityUnit: "g", priceMinor: 16000, isAvailable: true },
          { name: "8 Pieces (~800g)", pricingType: "WEIGHT", quantityValue: 800, quantityUnit: "g", priceMinor: 30000, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["fresh-chicken"].id,
      name: "Tender Chicken Wings",
      slug: "tender-chicken-wings",
      description: "Crispy-ready chicken wings including wingette and drumette. Ideal for hot wings and frying.",
      productType: "WEIGHT",
      isHalal: true,
      foodType: "NON_VEG",
      isAvailable: true,
      imageUrl: "/images/products/tender-chicken-wings.jpg",
      displayOrder: 4,
      variants: {
        create: [
          { name: "500g Pack", pricingType: "WEIGHT", quantityValue: 500, quantityUnit: "g", priceMinor: 13000, isAvailable: true },
          { name: "1kg Pack", pricingType: "WEIGHT", quantityValue: 1000, quantityUnit: "g", priceMinor: 24000, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["fresh-chicken"].id,
      name: "Whole Spring Chicken (Cleaned & Dressed)",
      slug: "whole-spring-chicken",
      description: "Completely cleaned, gutted, and dressed whole spring chicken. Great for roasts or whole tandoori.",
      productType: "WEIGHT",
      isHalal: true,
      foodType: "NON_VEG",
      isAvailable: true,
      imageUrl: "/images/products/whole-spring-chicken.jpg",
      displayOrder: 5,
      variants: {
        create: [
          { name: "1 Bird (~1000g)", pricingType: "WEIGHT", quantityValue: 1000, quantityUnit: "g", priceMinor: 23000, isAvailable: true },
          { name: "1 Large Bird (~1200g)", pricingType: "WEIGHT", quantityValue: 1200, quantityUnit: "g", priceMinor: 27000, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["masala-special"].id,
      name: "Chef Special Marinated Chicken Kebab",
      slug: "chef-special-marinated-chicken-kebab",
      description: "Boneless chicken cubes marinated in authentic South Indian spices. Ready to fry or grill in 10 mins.",
      productType: "WEIGHT",
      isHalal: true,
      foodType: "NON_VEG",
      isAvailable: true,
      imageUrl: "/images/products/chef-special-marinated-chicken-kebab.jpg",
      displayOrder: 6,
      variants: {
        create: [
          { name: "500g Pack", pricingType: "WEIGHT", quantityValue: 500, quantityUnit: "g", priceMinor: 21000, isAvailable: true },
          { name: "1kg Pack", pricingType: "WEIGHT", quantityValue: 1000, quantityUnit: "g", priceMinor: 40000, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["masala-special"].id,
      name: "Peri-Peri Marinated Chicken Wings",
      slug: "peri-peri-marinated-chicken-wings",
      description: "Spicy and tangy African birds-eye chili peri-peri marinated fresh wings. Finger-licking delicious.",
      productType: "WEIGHT",
      isHalal: true,
      foodType: "NON_VEG",
      isAvailable: true,
      imageUrl: "/images/products/peri-peri-marinated-chicken-wings.jpg",
      displayOrder: 7,
      variants: {
        create: [
          { name: "500g Pack", pricingType: "WEIGHT", quantityValue: 500, quantityUnit: "g", priceMinor: 18000, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["eggs"].id,
      name: "Pure Country Desi Nati Eggs",
      slug: "pure-country-desi-nati-eggs",
      description: "Naturally raised free-range country desi hen eggs. Packed with natural nutrients and deep yellow yolk.",
      productType: "PIECE",
      isHalal: false,
      foodType: "EGG",
      isAvailable: true,
      imageUrl: "/images/products/pure-country-desi-nati-eggs.jpg",
      displayOrder: 8,
      variants: {
        create: [
          { name: "6 Eggs Pack", pricingType: "PIECE", quantityValue: 6, quantityUnit: "pc", priceMinor: 7500, isAvailable: true },
          { name: "12 Eggs Tray", pricingType: "PIECE", quantityValue: 12, quantityUnit: "pc", priceMinor: 14000, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["eggs"].id,
      name: "Fresh Farm White Eggs",
      slug: "fresh-farm-white-eggs",
      description: "Freshly harvested white farm eggs. Cleaned, inspected, and packed for your daily breakfast protein.",
      productType: "PIECE",
      isHalal: false,
      foodType: "EGG",
      isAvailable: true,
      imageUrl: "/images/products/fresh-farm-white-eggs.jpg",
      displayOrder: 9,
      variants: {
        create: [
          { name: "6 Eggs Pack", pricingType: "PIECE", quantityValue: 6, quantityUnit: "pc", priceMinor: 4500, isAvailable: true },
          { name: "30 Eggs Jumbo Crate", pricingType: "PIECE", quantityValue: 30, quantityUnit: "pc", priceMinor: 21000, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["beverages"].id,
      name: "Thums Up (Extra Strong)",
      slug: "thums-up-750ml",
      description: "Chilled bottle of Thums Up soft drink. The classic fiery companion for hot and spicy chicken curries.",
      productType: "FIXED",
      isHalal: false,
      foodType: "VEG",
      isAvailable: true,
      imageUrl: "/images/products/thums-up-750ml.jpg",
      displayOrder: 10,
      variants: {
        create: [
          { name: "750ml Bottle", pricingType: "FIXED", quantityValue: 1, quantityUnit: "pack", priceMinor: 4000, isAvailable: true },
        ],
      },
    },
  ];

  for (const cp of chickenProducts) {
    const isMeat = cp.categoryId === catMap["fresh-chicken"].id || cp.categoryId === catMap["masala-special"].id;
    await prisma.product.create({
      data: {
        ...cp,
        ...(isMeat && {
          customizationGroups: {
            create: chickenCustomizationGroups.map((g) => ({
              name: g.name,
              selectionType: g.selectionType,
              isRequired: g.isRequired,
              displayOrder: g.displayOrder,
              options: {
                create: g.options,
              },
            })),
          },
        }),
      },
    });
  }

  // 7. Create Expansion Meat Items (Fish & Mutton - COMING SOON)
  const expansionMeat = [
    {
      categoryId: catMap["fish-seafood"].id,
      name: "Fresh Rohu / Catla (Bengali Curry Cut)",
      slug: "fresh-rohu-catla-curry-cut",
      description: "Descaled, cleaned, and steak-cut sweet water Rohu/Catla. Freshly sourced and chemical-free.",
      imageUrl: "/images/products/fresh-rohu-catla-curry-cut.jpg",
      productType: "WEIGHT",
      foodType: "NON_VEG",
      isHalal: true,
      isAvailable: false,
      badgeText: "Coming Soon",
      mrpMinor: 22000,
      displayOrder: 11,
      variants: {
        create: [
          { name: "500g Pack", quantityValue: 500, quantityUnit: "g", priceMinor: 17500, mrpMinor: 22000, isAvailable: false },
          { name: "1kg Family Pack", quantityValue: 1000, quantityUnit: "g", priceMinor: 34000, mrpMinor: 42000, isAvailable: false },
        ],
      },
    },
    {
      categoryId: catMap["fish-seafood"].id,
      name: "Premium Sea White Prawns (Peeled & Deveined)",
      slug: "premium-sea-white-prawns",
      description: "Tail-on, peeled, and deveined succulent sea white prawns. Sweet, juicy, and ready to cook.",
      imageUrl: "/images/products/premium-sea-white-prawns.jpg",
      productType: "WEIGHT",
      foodType: "NON_VEG",
      isHalal: true,
      isAvailable: false,
      badgeText: "Coming Soon",
      mrpMinor: 30000,
      displayOrder: 12,
      variants: {
        create: [
          { name: "250g Pack", quantityValue: 250, quantityUnit: "g", priceMinor: 24000, mrpMinor: 30000, isAvailable: false },
          { name: "500g Pack", quantityValue: 500, quantityUnit: "g", priceMinor: 46000, mrpMinor: 58000, isAvailable: false },
        ],
      },
    },
    {
      categoryId: catMap["fish-seafood"].id,
      name: "King Fish / Seer Fish (Vanjaram Steaks)",
      slug: "king-fish-seer-fish-steaks",
      description: "Prime center-cut Surmai (Vanjaram) steaks. Firm white meat ideal for spicy tawa fry.",
      imageUrl: "/images/products/king-fish-seer-fish-steaks.jpg",
      productType: "WEIGHT",
      foodType: "NON_VEG",
      isHalal: true,
      isAvailable: false,
      badgeText: "Coming Soon",
      mrpMinor: 65000,
      displayOrder: 13,
      variants: {
        create: [
          { name: "500g Steaks", quantityValue: 500, quantityUnit: "g", priceMinor: 58000, mrpMinor: 65000, isAvailable: false },
          { name: "1kg Steaks", quantityValue: 1000, quantityUnit: "g", priceMinor: 112000, mrpMinor: 128000, isAvailable: false },
        ],
      },
    },
    {
      categoryId: catMap["fresh-mutton"].id,
      name: "Tender Goat Curry Cut (Rich & Juicy)",
      slug: "tender-goat-curry-cut",
      description: "Freshly cut tender young goat meat with a balanced mix of bone-in and boneless pieces.",
      imageUrl: "/images/products/tender-goat-curry-cut.jpg",
      productType: "WEIGHT",
      foodType: "NON_VEG",
      isHalal: true,
      isAvailable: false,
      badgeText: "Coming Soon",
      mrpMinor: 52000,
      displayOrder: 14,
      variants: {
        create: [
          { name: "500g Pack", quantityValue: 500, quantityUnit: "g", priceMinor: 46000, mrpMinor: 52000, isAvailable: false },
          { name: "1kg Family Pack", quantityValue: 1000, quantityUnit: "g", priceMinor: 89000, mrpMinor: 100000, isAvailable: false },
        ],
      },
    },
    {
      categoryId: catMap["fresh-mutton"].id,
      name: "Special Goat Biryani Cut (Succulent Bone-In)",
      slug: "special-goat-biryani-cut",
      description: "Larger succulent pieces including shoulder, ribs, and shank cut specially for dum biryani.",
      imageUrl: "/images/products/special-goat-biryani-cut.jpg",
      productType: "WEIGHT",
      foodType: "NON_VEG",
      isHalal: true,
      isAvailable: false,
      badgeText: "Coming Soon",
      mrpMinor: 55000,
      displayOrder: 15,
      variants: {
        create: [
          { name: "500g Pack", quantityValue: 500, quantityUnit: "g", priceMinor: 48000, mrpMinor: 55000, isAvailable: false },
          { name: "1kg Feast Pack", quantityValue: 1000, quantityUnit: "g", priceMinor: 94000, mrpMinor: 108000, isAvailable: false },
        ],
      },
    },
    {
      categoryId: catMap["fresh-mutton"].id,
      name: "Fresh Goat Keema (Fine Minced)",
      slug: "fresh-goat-keema-minced",
      description: "Double-minced tender goat meat, expertly trimmed of excess fat. Ideal for keema mutter.",
      imageUrl: "/images/products/fresh-goat-keema-minced.jpg",
      productType: "WEIGHT",
      foodType: "NON_VEG",
      isHalal: true,
      isAvailable: false,
      badgeText: "Coming Soon",
      mrpMinor: 30000,
      displayOrder: 16,
      variants: {
        create: [
          { name: "250g Pack", quantityValue: 250, quantityUnit: "g", priceMinor: 25000, mrpMinor: 30000, isAvailable: false },
          { name: "500g Pack", quantityValue: 500, quantityUnit: "g", priceMinor: 48000, mrpMinor: 58000, isAvailable: false },
        ],
      },
    },
  ];

  for (const em of expansionMeat) {
    await prisma.product.create({ data: em });
  }

  // 8. Create JioMart Groceries
  const groceries = [
    {
      categoryId: catMap["dairy-eggs-bread"].id,
      name: "Amul Butter - Pasteurized",
      slug: "amul-butter-pasteurized",
      description: "Utterly Butterly Delicious Amul butter made from pure fresh milk cream.",
      imageUrl: "/images/products/amul-butter-pasteurized.jpg",
      productType: "FIXED",
      foodType: "VEG",
      isAvailable: true,
      badgeText: "Daily Essentials at Wholesale Prices",
      mrpMinor: 6000,
      displayOrder: 20,
      variants: {
        create: [
          { name: "100g Pack", quantityValue: 100, quantityUnit: "g", priceMinor: 5800, mrpMinor: 6000, isAvailable: true },
          { name: "500g Tub", quantityValue: 500, quantityUnit: "g", priceMinor: 27500, mrpMinor: 28500, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["dairy-eggs-bread"].id,
      name: "Nandini Fresh Toned Milk",
      slug: "nandini-fresh-toned-milk",
      description: "Daily fresh pasteurized toned milk from Karnataka Milk Federation (KMF).",
      imageUrl: "/images/products/nandini-fresh-toned-milk.jpg",
      productType: "FIXED",
      foodType: "VEG",
      isAvailable: true,
      badgeText: "Daily Essentials at Wholesale Prices",
      mrpMinor: 2500,
      displayOrder: 21,
      variants: {
        create: [
          { name: "500 ml Pouch", quantityValue: 500, quantityUnit: "ml", priceMinor: 2400, mrpMinor: 2500, isAvailable: true },
          { name: "1 Litre Pouch", quantityValue: 1000, quantityUnit: "ml", priceMinor: 4600, mrpMinor: 4800, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["dairy-eggs-bread"].id,
      name: "Fresh Malai Paneer Cubes",
      slug: "fresh-malai-paneer-cubes",
      description: "Soft, succulent, high-protein paneer made from full cream cow milk.",
      imageUrl: "/images/products/fresh-malai-paneer-cubes.jpg",
      productType: "WEIGHT",
      foodType: "VEG",
      isAvailable: true,
      badgeText: "Daily Essentials at Wholesale Prices",
      mrpMinor: 11000,
      displayOrder: 22,
      variants: {
        create: [
          { name: "200g Pack", quantityValue: 200, quantityUnit: "g", priceMinor: 9500, mrpMinor: 11000, isAvailable: true },
          { name: "500g Family Pack", quantityValue: 500, quantityUnit: "g", priceMinor: 23000, mrpMinor: 26000, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["dairy-eggs-bread"].id,
      name: "Farm Fresh Brown Eggs (Nutri-Rich)",
      slug: "farm-fresh-brown-eggs",
      description: "Naturally laid country brown eggs packed with Omega-3 and protein.",
      imageUrl: "/images/products/farm-fresh-brown-eggs.jpg",
      productType: "PIECE",
      foodType: "EGG",
      isAvailable: true,
      badgeText: "Daily Essentials at Wholesale Prices",
      mrpMinor: 7500,
      displayOrder: 23,
      variants: {
        create: [
          { name: "6 Pieces Pack", quantityValue: 6, quantityUnit: "pc", priceMinor: 6500, mrpMinor: 7500, isAvailable: true },
          { name: "12 Pieces Tray", quantityValue: 12, quantityUnit: "pc", priceMinor: 12500, mrpMinor: 14500, isAvailable: true },
          { name: "30 Pieces Jumbo Crate", quantityValue: 30, quantityUnit: "pc", priceMinor: 29500, mrpMinor: 34000, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["atta-rice-dal"].id,
      name: "India Gate Super Basmati Rice",
      slug: "india-gate-super-basmati-rice",
      description: "Long grain aromatic basmati rice aged to perfection.",
      imageUrl: "/images/products/india-gate-super-basmati-rice.jpg",
      productType: "WEIGHT",
      foodType: "VEG",
      isAvailable: true,
      badgeText: "Daily Essentials at Wholesale Prices",
      mrpMinor: 17000,
      displayOrder: 24,
      variants: {
        create: [
          { name: "1 kg Pack", quantityValue: 1000, quantityUnit: "g", priceMinor: 14500, mrpMinor: 17000, isAvailable: true },
          { name: "5 kg Bag", quantityValue: 5000, quantityUnit: "g", priceMinor: 68000, mrpMinor: 78000, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["atta-rice-dal"].id,
      name: "Aashirvaad Shudh Chakki Atta (100% Whole Wheat)",
      slug: "aashirvaad-shudh-chakki-atta",
      description: "Made from premium golden grains using traditional chakki stone grinding.",
      imageUrl: "/images/products/aashirvaad-shudh-chakki-atta.jpg",
      productType: "WEIGHT",
      foodType: "VEG",
      isAvailable: true,
      badgeText: "Daily Essentials at Wholesale Prices",
      mrpMinor: 26000,
      displayOrder: 25,
      variants: {
        create: [
          { name: "5 kg Bag", quantityValue: 5000, quantityUnit: "g", priceMinor: 23500, mrpMinor: 26000, isAvailable: true },
          { name: "10 kg Bag", quantityValue: 10000, quantityUnit: "g", priceMinor: 45000, mrpMinor: 51000, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["atta-rice-dal"].id,
      name: "Tata Sampann Unpolished Toor Dal",
      slug: "tata-sampann-unpolished-toor-dal",
      description: "High protein natural toor dal without artificial polishing or color.",
      imageUrl: "/images/products/tata-sampann-unpolished-toor-dal.jpg",
      productType: "WEIGHT",
      foodType: "VEG",
      isAvailable: true,
      badgeText: "Daily Essentials at Wholesale Prices",
      mrpMinor: 9500,
      displayOrder: 26,
      variants: {
        create: [
          { name: "500g Pack", quantityValue: 500, quantityUnit: "g", priceMinor: 8500, mrpMinor: 9500, isAvailable: true },
          { name: "1 kg Pack", quantityValue: 1000, quantityUnit: "g", priceMinor: 16500, mrpMinor: 18500, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["oils-ghee"].id,
      name: "Fortune Sunlite Refined Sunflower Oil",
      slug: "fortune-sunlite-sunflower-oil",
      description: "Light and healthy sunflower cooking oil enriched with Vitamins A & D.",
      imageUrl: "/images/products/fortune-sunlite-sunflower-oil.jpg",
      productType: "FIXED",
      foodType: "VEG",
      isAvailable: true,
      badgeText: "Daily Essentials at Wholesale Prices",
      mrpMinor: 15500,
      displayOrder: 27,
      variants: {
        create: [
          { name: "1 Litre Pouch", quantityValue: 1000, quantityUnit: "ml", priceMinor: 13500, mrpMinor: 15500, isAvailable: true },
          { name: "5 Litre Jerry Can", quantityValue: 5000, quantityUnit: "ml", priceMinor: 65000, mrpMinor: 74000, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["oils-ghee"].id,
      name: "Nandini Pure Cow Desi Ghee",
      slug: "nandini-pure-cow-ghee",
      description: "Golden granular pure cow ghee with traditional aroma and rich flavor.",
      imageUrl: "/images/products/nandini-pure-cow-ghee.jpg",
      productType: "FIXED",
      foodType: "VEG",
      isAvailable: true,
      badgeText: "Daily Essentials at Wholesale Prices",
      mrpMinor: 14500,
      displayOrder: 28,
      variants: {
        create: [
          { name: "200 ml Jar", quantityValue: 200, quantityUnit: "ml", priceMinor: 13000, mrpMinor: 14500, isAvailable: true },
          { name: "500 ml Jar", quantityValue: 500, quantityUnit: "ml", priceMinor: 31000, mrpMinor: 34500, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["spices-masalas"].id,
      name: "Everest Chicken Masala (Special Blend)",
      slug: "everest-chicken-masala",
      description: "Exotic blend to prepare restaurant-grade chicken curry at home.",
      imageUrl: "/images/products/everest-chicken-masala.jpg",
      productType: "FIXED",
      foodType: "VEG",
      isAvailable: true,
      badgeText: "Daily Essentials at Wholesale Prices",
      mrpMinor: 4800,
      displayOrder: 29,
      variants: {
        create: [
          { name: "100g Carton", quantityValue: 100, quantityUnit: "g", priceMinor: 4200, mrpMinor: 4800, isAvailable: true },
          { name: "200g Saver Pack", quantityValue: 200, quantityUnit: "g", priceMinor: 8000, mrpMinor: 9200, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["spices-masalas"].id,
      name: "Mother's Recipe Ginger Garlic Paste",
      slug: "mothers-recipe-ginger-garlic-paste",
      description: "Freshly ground paste with 100% real ginger and garlic.",
      imageUrl: "/images/products/mothers-recipe-ginger-garlic-paste.jpg",
      productType: "FIXED",
      foodType: "VEG",
      isAvailable: true,
      badgeText: "Daily Essentials at Wholesale Prices",
      mrpMinor: 4000,
      displayOrder: 30,
      variants: {
        create: [
          { name: "200g Pouch", quantityValue: 200, quantityUnit: "g", priceMinor: 3500, mrpMinor: 4000, isAvailable: true },
          { name: "300g Standee Tub", quantityValue: 300, quantityUnit: "g", priceMinor: 5500, mrpMinor: 6500, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["fresh-vegetables"].id,
      name: "Fresh Red Onions (discounted Pick)",
      slug: "fresh-red-onions",
      description: "Firm, crisp red onions sourced directly from local Kolar/Mulbagal farmers.",
      imageUrl: "/images/products/fresh-red-onions.jpg",
      productType: "WEIGHT",
      foodType: "VEG",
      isAvailable: true,
      badgeText: "Daily Essentials at Wholesale Prices",
      mrpMinor: 4500,
      displayOrder: 31,
      variants: {
        create: [
          { name: "1 kg Bag", quantityValue: 1000, quantityUnit: "g", priceMinor: 3800, mrpMinor: 4500, isAvailable: true },
          { name: "2 kg Family Pack", quantityValue: 2000, quantityUnit: "g", priceMinor: 7200, mrpMinor: 8800, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["fresh-vegetables"].id,
      name: "Hybrid Juicy Red Tomatoes",
      slug: "hybrid-juicy-red-tomatoes",
      description: "Plump, ripe red tomatoes freshly harvested for rich curry bases and salads.",
      imageUrl: "/images/products/hybrid-juicy-red-tomatoes.jpg",
      productType: "WEIGHT",
      foodType: "VEG",
      isAvailable: true,
      badgeText: "Daily Essentials at Wholesale Prices",
      mrpMinor: 3500,
      displayOrder: 32,
      variants: {
        create: [
          { name: "1 kg Pack", quantityValue: 1000, quantityUnit: "g", priceMinor: 2800, mrpMinor: 3500, isAvailable: true },
          { name: "2 kg Pack", quantityValue: 2000, quantityUnit: "g", priceMinor: 5400, mrpMinor: 6800, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["tea-beverages"].id,
      name: "Tata Tea Gold (Rich Leaf & CTC)",
      slug: "tata-tea-gold",
      description: "Finest blend of Assam CTC tea with 15% gently rolled long tea leaves.",
      imageUrl: "/images/products/tata-tea-gold.jpg",
      productType: "FIXED",
      foodType: "VEG",
      isAvailable: true,
      badgeText: "Daily Essentials at Wholesale Prices",
      mrpMinor: 15500,
      displayOrder: 33,
      variants: {
        create: [
          { name: "250g Pack", quantityValue: 250, quantityUnit: "g", priceMinor: 14000, mrpMinor: 15500, isAvailable: true },
          { name: "500g Value Pack", quantityValue: 500, quantityUnit: "g", priceMinor: 27000, mrpMinor: 29500, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["tea-beverages"].id,
      name: "Bru Instant Roasted Coffee",
      slug: "bru-instant-roasted-coffee",
      description: "Made from a fine blend of the choicest plantation and Robusta beans.",
      imageUrl: "/images/products/bru-instant-roasted-coffee.jpg",
      productType: "FIXED",
      foodType: "VEG",
      isAvailable: true,
      badgeText: "Daily Essentials at Wholesale Prices",
      mrpMinor: 18500,
      displayOrder: 34,
      variants: {
        create: [
          { name: "100g Glass Jar", quantityValue: 100, quantityUnit: "g", priceMinor: 16500, mrpMinor: 18500, isAvailable: true },
          { name: "200g Saver Pouch", quantityValue: 200, quantityUnit: "g", priceMinor: 31000, mrpMinor: 34500, isAvailable: true },
        ],
      },
    },
    {
      categoryId: catMap["spices-masalas"].id,
      name: "Home Lite Safety Matchbox",
      slug: "safety-matchbox",
      description: "Extra-long damp-proof wooden safety matchsticks for kitchen stove & pooja use (40 sticks per box).",
      imageUrl: "/images/products/safety-matchbox.jpg",
      productType: "PIECE",
      foodType: "VEG",
      isAvailable: true,
      badgeText: "Daily Household Essential • ₹2",
      mrpMinor: 200,
      displayOrder: 0,
      variants: {
        create: [
          { name: "1 Box (40 Sticks)", quantityValue: 1, quantityUnit: "pc", priceMinor: 200, mrpMinor: 200, isAvailable: true },
          { name: "Pack of 5 Boxes", quantityValue: 5, quantityUnit: "pc", priceMinor: 1000, mrpMinor: 1200, isAvailable: true },
        ],
      },
    },
  ];

  for (const g of groceries) {
    await prisma.product.create({ data: g });
  }

  console.log("Seeded all 32 Products and Variants across MEAT and GROCERY");

  // 9. Promotional Coupons: Strictly Admin-Controlled (zero pre-seeded fake coupons)
  console.log("Coupons: 0 pre-seeded (Strictly Admin-Controlled via /admin/coupons)");

  console.log("\n==================================================");
  console.log("HOMEMART4U PRODUCTION DATABASE INITIALIZED");
  console.log("==================================================");
  console.log("Admin User: [Protected / Configured via ENV]");
  console.log("Categories: 12 (Fresh Chicken, Masala, Eggs, Fish Soon, Beverages, Mutton Soon, Groceries)");
  console.log("Products: 32 items with high-resolution imagery and variants");
  console.log("Clean State: Zero mock orders, zero fake coupons, ready for live operations.");
  console.log("==================================================\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
